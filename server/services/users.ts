import "server-only"
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm"
import { z } from "zod"
import { db, schema } from "@/server/db"
import { AppError, isUniqueViolation, notFound } from "@/server/http/errors"
import { hashPassword } from "@/server/auth/password"
import { revokeAllSessionsFor } from "@/server/auth/session"
import { ARENA_ROLE_KEYS, PERMISSIONS, type ArenaRoleKey, type Permission, type RoleKey } from "@/lib/domain/constants"
import { recordAudit, type AuditActor } from "./audit"
import { assertAdminWritable, assertWithinPlanLimit } from "./billing"

/**
 * Staff management, scoped to one arena.
 *
 * A staff member is a user plus an `arena_memberships` row. The identity is
 * global — the same person can work for two arenas — but everything here acts
 * on the membership, so one arena can never see, change or remove another
 * arena's staff. The arena is always passed in by the caller, which resolved
 * it from the request; it is never derived from the target user.
 *
 * Platform roles are not assignable here, so an arena owner cannot mint an
 * Game Slots operator.
 */

export const staffInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  roleKey: z.enum(ARENA_ROLE_KEYS),
  password: z.string().min(10).max(200).optional(),
  isActive: z.boolean().default(true),
})
export type StaffInput = z.infer<typeof staffInputSchema>

/** Who is acting, and with what standing in this arena. */
export interface StaffContext {
  arenaId: string
  actor: AuditActor & { id?: string | null }
  actorRoleKey: ArenaRoleKey
}

function sanitize(u: schema.User) {
  const { passwordHash: _p, ...rest } = u
  void _p
  return rest
}

async function roleByKey(key: RoleKey) {
  const database = await db()
  const role = await database.query.roles.findFirst({ where: eq(schema.roles.key, key) })
  if (!role) throw notFound("Role")
  return role
}

/**
 * Only an owner may create or alter another owner. Without this an
 * ARENA_ADMIN could promote themselves past the person who hired them.
 */
function assertMayAssign(roleKey: ArenaRoleKey | undefined, actorRoleKey: ArenaRoleKey) {
  if (roleKey === "ARENA_OWNER" && actorRoleKey !== "ARENA_OWNER") {
    throw new AppError("FORBIDDEN", "Only an arena owner can grant the owner role")
  }
}

/** The membership row for a staff member of this arena, or a 404. */
async function membershipIn(arenaId: string, userId: string) {
  const database = await db()
  const membership = await database.query.arenaMemberships.findFirst({
    where: and(eq(schema.arenaMemberships.arenaId, arenaId), eq(schema.arenaMemberships.userId, userId)),
  })
  // Reported as not found, not forbidden: whether this person exists in some
  // other arena is not this arena's business.
  if (!membership || membership.status === "REMOVED") throw notFound("Staff member")
  return membership
}

export async function listStaff(
  arenaId: string,
  opts: { q?: string; roleKey?: string; page?: number; pageSize?: number } = {}
) {
  const database = await db()
  const page = opts.page ?? 1
  const pageSize = opts.pageSize ?? 20
  const where: SQL[] = [eq(schema.arenaMemberships.arenaId, arenaId), isNull(schema.users.deletedAt)]
  if (opts.q) where.push(or(ilike(schema.users.name, `%${opts.q}%`), ilike(schema.users.email, `%${opts.q}%`))!)
  if (opts.roleKey && opts.roleKey !== "all") where.push(eq(schema.roles.key, opts.roleKey as RoleKey))
  const condition = and(...where)

  const [{ count }] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.arenaMemberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.arenaMemberships.userId))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.arenaMemberships.roleId))
    .where(condition)

  const items = await database
    .select({
      user: schema.users,
      role: { key: schema.roles.key, name: schema.roles.name },
      membership: { id: schema.arenaMemberships.id, status: schema.arenaMemberships.status },
    })
    .from(schema.arenaMemberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.arenaMemberships.userId))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.arenaMemberships.roleId))
    .where(condition)
    .orderBy(desc(schema.arenaMemberships.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return {
    items: items.map(({ user, role, membership }) => ({
      ...sanitize(user),
      role,
      membershipStatus: membership.status,
      // Usable only when both the identity and the membership are live, so the
      // UI shows one honest flag rather than two.
      isActive: user.isActive && membership.status === "ACTIVE",
    })),
    meta: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) },
  }
}

/**
 * Adds a staff member to this arena. An existing Game Slots identity with the
 * same email is reused and given a membership — the same person can work for
 * two arenas — rather than being refused or duplicated.
 */
export async function createStaff(input: StaffInput, ctx: StaffContext) {
  assertMayAssign(input.roleKey, ctx.actorRoleKey)
  await assertAdminWritable(ctx.arenaId)
  await assertWithinPlanLimit({ arenaId: ctx.arenaId }, "STAFF")
  const database = await db()
  const role = await roleByKey(input.roleKey)
  const email = input.email.toLowerCase()

  const existingUser = await database.query.users.findFirst({
    where: and(sql`lower(${schema.users.email}) = ${email}`, isNull(schema.users.deletedAt)),
  })

  if (existingUser) {
    const existingMembership = await database.query.arenaMemberships.findFirst({
      where: and(eq(schema.arenaMemberships.arenaId, ctx.arenaId), eq(schema.arenaMemberships.userId, existingUser.id)),
    })
    if (existingMembership && existingMembership.status !== "REMOVED") {
      throw new AppError("EMAIL_TAKEN", "This person is already a member of this arena")
    }
    const [membership] = existingMembership
      ? await database
          .update(schema.arenaMemberships)
          .set({ roleId: role.id, status: "ACTIVE", removedAt: null, acceptedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.arenaMemberships.id, existingMembership.id))
          .returning()
      : await database
          .insert(schema.arenaMemberships)
          .values({ arenaId: ctx.arenaId, userId: existingUser.id, roleId: role.id, status: "ACTIVE", acceptedAt: new Date(), invitedByUserId: ctx.actor.id ?? null })
          .returning()
    await recordAudit(ctx.actor, {
      action: "staff.invite",
      entityType: "user",
      entityId: existingUser.id,
      arenaId: ctx.arenaId,
      description: `Added existing account ${existingUser.email} as ${role.name}`,
      metadata: { role: role.key, membershipId: membership.id },
    })
    return { ...sanitize(existingUser), role: { key: role.key, name: role.name }, membershipStatus: membership.status, isActive: existingUser.isActive }
  }

  if (!input.password) throw new AppError("VALIDATION_ERROR", "A password is required for a new account")
  const passwordHash = await hashPassword(input.password)

  try {
    const created = await database.transaction(async (tx) => {
      const [user] = await tx
        .insert(schema.users)
        .values({ name: input.name, email, phone: input.phone || null, passwordHash, isActive: input.isActive })
        .returning()
      await tx
        .insert(schema.arenaMemberships)
        .values({ arenaId: ctx.arenaId, userId: user.id, roleId: role.id, status: "ACTIVE", acceptedAt: new Date(), invitedByUserId: ctx.actor.id ?? null })
      return user
    })
    await recordAudit(ctx.actor, {
      action: "staff.invite",
      entityType: "user",
      entityId: created.id,
      arenaId: ctx.arenaId,
      description: `Created ${role.name} account for ${created.name}`,
      metadata: { role: role.key },
    })
    return { ...sanitize(created), role: { key: role.key, name: role.name }, membershipStatus: "ACTIVE" as const, isActive: created.isActive }
  } catch (err) {
    if (isUniqueViolation(err, "users_email_lower_idx")) throw new AppError("EMAIL_TAKEN", "An account with this email already exists")
    throw err
  }
}

export async function updateStaff(userId: string, input: Partial<StaffInput>, ctx: StaffContext) {
  const database = await db()
  // Membership first: a user who is not a member of this arena is invisible
  // here, whatever their id.
  const membership = await membershipIn(ctx.arenaId, userId)
  const existing = await database.query.users.findFirst({ where: and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)) })
  if (!existing) throw notFound("Staff member")

  const currentRole = (await database.query.roles.findFirst({ where: eq(schema.roles.id, membership.roleId) }))!
  if (currentRole.key === "ARENA_OWNER" && ctx.actorRoleKey !== "ARENA_OWNER") {
    throw new AppError("FORBIDDEN", "Only an arena owner can modify another owner")
  }
  assertMayAssign(input.roleKey, ctx.actorRoleKey)
  if (userId === ctx.actor.id && (input.isActive === false || (input.roleKey && input.roleKey !== currentRole.key))) {
    throw new AppError("CONFLICT", "You cannot deactivate or change the role of your own account")
  }

  const userPatch: Partial<schema.User> = { updatedAt: new Date() }
  if (input.name) userPatch.name = input.name
  if (input.email) userPatch.email = input.email.toLowerCase()
  if (input.phone !== undefined) userPatch.phone = input.phone || null
  if (input.password) userPatch.passwordHash = await hashPassword(input.password)
  const [row] = await database.update(schema.users).set(userPatch).where(eq(schema.users.id, userId)).returning()

  // Role and suspension live on the membership: suspending someone here must
  // not touch their access to another arena.
  const membershipPatch: Partial<schema.ArenaMembership> = { updatedAt: new Date() }
  if (input.roleKey) membershipPatch.roleId = (await roleByKey(input.roleKey)).id
  if (input.isActive !== undefined) {
    membershipPatch.status = input.isActive ? "ACTIVE" : "SUSPENDED"
    membershipPatch.suspendedAt = input.isActive ? null : new Date()
  }
  const [updatedMembership] = await database
    .update(schema.arenaMemberships)
    .set(membershipPatch)
    .where(eq(schema.arenaMemberships.id, membership.id))
    .returning()

  const role = (await database.query.roles.findFirst({ where: eq(schema.roles.id, updatedMembership.roleId) }))!
  // Privilege or status changes take effect immediately.
  if (input.isActive === false || input.password || (input.roleKey && input.roleKey !== currentRole.key)) {
    await revokeAllSessionsFor("user", userId)
  }
  await recordAudit(ctx.actor, {
    action: "staff.update",
    entityType: "user",
    entityId: userId,
    arenaId: ctx.arenaId,
    description: `Updated ${row.name}`,
    metadata: { role: role.key, membershipStatus: updatedMembership.status, passwordChanged: !!input.password },
  })
  return { ...sanitize(row), role: { key: role.key, name: role.name }, membershipStatus: updatedMembership.status, isActive: row.isActive && updatedMembership.status === "ACTIVE" }
}

/**
 * Removes someone from this arena. The identity survives — they may still work
 * for another arena, and deleting the user row would take that access with it —
 * so this ends the membership, not the account.
 */
export async function removeStaff(userId: string, ctx: StaffContext) {
  if (userId === ctx.actor.id) throw new AppError("CONFLICT", "You cannot remove your own access")
  const database = await db()
  const membership = await membershipIn(ctx.arenaId, userId)
  const role = (await database.query.roles.findFirst({ where: eq(schema.roles.id, membership.roleId) }))!
  if (role.key === "ARENA_OWNER" && ctx.actorRoleKey !== "ARENA_OWNER") {
    throw new AppError("FORBIDDEN", "Only an arena owner can remove another owner")
  }
  if (role.key === "ARENA_OWNER") {
    const [{ count }] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.arenaMemberships)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.arenaMemberships.roleId))
      .where(and(eq(schema.arenaMemberships.arenaId, ctx.arenaId), eq(schema.arenaMemberships.status, "ACTIVE"), eq(schema.roles.key, "ARENA_OWNER")))
    if (Number(count) <= 1) throw new AppError("CONFLICT", "An arena must keep at least one owner")
  }

  await database
    .update(schema.arenaMemberships)
    .set({ status: "REMOVED", removedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.arenaMemberships.id, membership.id))
  await revokeAllSessionsFor("user", userId)
  const user = await database.query.users.findFirst({ where: eq(schema.users.id, userId) })
  await recordAudit(ctx.actor, {
    action: "staff.remove",
    entityType: "user",
    entityId: userId,
    arenaId: ctx.arenaId,
    description: `Removed ${user?.name ?? userId} from this arena`,
  })
}

// ---------------------------------------------------------------------------
// Role catalogue — platform level
// ---------------------------------------------------------------------------

/**
 * Roles are shared by every arena, so reading and editing them is a platform
 * concern. `userCount` counts memberships, not user rows: one person working
 * for two arenas holds the role twice.
 */
export async function listRolesWithPermissions() {
  const database = await db()
  const roles = await database.query.roles.findMany({ orderBy: [asc(schema.roles.createdAt)] })
  const perms = await database.query.rolePermissions.findMany()
  const counts = await database
    .select({ roleId: schema.arenaMemberships.roleId, count: sql<number>`count(*)::int` })
    .from(schema.arenaMemberships)
    .where(eq(schema.arenaMemberships.status, "ACTIVE"))
    .groupBy(schema.arenaMemberships.roleId)
  return roles.map((r) => ({
    ...r,
    permissions: perms.filter((p) => p.roleId === r.id).map((p) => p.permission as Permission),
    userCount: Number(counts.find((c) => c.roleId === r.id)?.count ?? 0),
  }))
}

export async function setRolePermissions(roleKey: RoleKey, permissions: Permission[], ctx: { actor: AuditActor }) {
  if (roleKey === "PLATFORM_OWNER") throw new AppError("CONFLICT", "Platform owner permissions cannot be changed")
  const invalid = permissions.filter((p) => !PERMISSIONS.includes(p))
  if (invalid.length) throw new AppError("VALIDATION_ERROR", `Unknown permissions: ${invalid.join(", ")}`)
  const database = await db()
  const role = await roleByKey(roleKey)
  // An arena role may never hold a platform permission, and a platform role
  // has no use for an arena one: the scope decides which vocabulary applies.
  const wrongScope = permissions.filter((p) => p.startsWith("platform.") !== (role.scope === "PLATFORM"))
  if (wrongScope.length) {
    throw new AppError("VALIDATION_ERROR", `These permissions do not belong to a ${role.scope.toLowerCase()} role: ${wrongScope.join(", ")}`)
  }
  await database.transaction(async (tx) => {
    await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, role.id))
    if (permissions.length) await tx.insert(schema.rolePermissions).values(permissions.map((permission) => ({ roleId: role.id, permission })))
  })
  await recordAudit(ctx.actor, { action: "role.permissions.update", entityType: "role", entityId: role.id, description: `Updated permissions for ${role.name}`, metadata: { permissions } })
  return listRolesWithPermissions()
}
