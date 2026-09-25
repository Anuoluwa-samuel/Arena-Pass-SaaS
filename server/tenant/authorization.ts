import "server-only"
import { and, eq, inArray, isNull, ne } from "drizzle-orm"
import { db, schema } from "@/server/db"
import { AppError, forbidden } from "@/server/http/errors"
import { logger } from "@/server/observability/logger"
import {
  ARENA_PERMISSIONS,
  isPlatformPermission,
  type ArenaRoleKey,
  type Permission,
  type PlatformRoleKey,
} from "@/lib/domain/constants"

/**
 * The one place that answers "may this user do this, here?".
 *
 * Two separate grants, never interchangeable:
 *
 *  - An **arena** permission is held through an ACTIVE `arena_memberships`
 *    row. Nothing else grants it — not an email address, not a URL slug, not
 *    a request body, and not a platform role.
 *  - A **platform** permission is held through `users.platform_role_id`, and
 *    is never satisfied by a membership.
 *
 * A platform role deliberately does *not* imply access to any tenant's data.
 * A platform operator who needs to act inside an arena does so through
 * explicit, audited impersonation, which is a separate mechanism; otherwise
 * "platform admin" would silently become "read every arena".
 */

export interface ArenaAccess {
  arenaId: string
  arenaSlug: string
  arenaName: string
  membershipId: string
  roleKey: ArenaRoleKey
  roleName: string
  permissions: Permission[]
  /**
   * True when this access comes from an active impersonation rather than a
   * membership. Such access is read-only and time-limited, and the interface
   * says so on every screen.
   */
  impersonated?: boolean
  impersonationExpiresAt?: Date
}

/**
 * What a platform operator may see while impersonating: everything that ends
 * in `.view`, and nothing else. Looking is how support diagnoses a problem;
 * changing someone's arena is the tenant's own decision.
 */
export const IMPERSONATION_PERMISSIONS: readonly Permission[] = ARENA_PERMISSIONS.filter((p) => p.endsWith(".view"))

export interface PlatformAccess {
  roleKey: PlatformRoleKey
  roleName: string
  permissions: Permission[]
}

/** The shape `authorize*` needs; the authenticated user satisfies it. */
export interface AuthorizableUser {
  id: string
  memberships: ArenaAccess[]
  platform: PlatformAccess | null
}

async function permissionsByRole(roleIds: string[]): Promise<Map<string, Permission[]>> {
  const map = new Map<string, Permission[]>()
  if (roleIds.length === 0) return map
  const database = await db()
  const rows = await database.query.rolePermissions.findMany({
    where: inArray(schema.rolePermissions.roleId, roleIds),
  })
  for (const row of rows) {
    const list = map.get(row.roleId) ?? []
    list.push(row.permission as Permission)
    map.set(row.roleId, list)
  }
  return map
}

/**
 * Every arena this user may currently act in. Only ACTIVE memberships of a
 * live arena count: an INVITED, SUSPENDED or REMOVED member has no access,
 * and neither does a member of an archived or deleted arena.
 */
export async function loadArenaMemberships(userId: string): Promise<ArenaAccess[]> {
  const database = await db()
  const rows = await database
    .select({
      membershipId: schema.arenaMemberships.id,
      arenaId: schema.arenas.id,
      arenaSlug: schema.arenas.slug,
      arenaName: schema.arenas.name,
      roleId: schema.roles.id,
      roleKey: schema.roles.key,
      roleName: schema.roles.name,
    })
    .from(schema.arenaMemberships)
    .innerJoin(schema.arenas, eq(schema.arenas.id, schema.arenaMemberships.arenaId))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.arenaMemberships.roleId))
    .where(
      and(
        eq(schema.arenaMemberships.userId, userId),
        eq(schema.arenaMemberships.status, "ACTIVE"),
        isNull(schema.arenas.deletedAt),
        ne(schema.arenas.status, "ARCHIVED")
      )
    )

  const permissions = await permissionsByRole([...new Set(rows.map((r) => r.roleId))])
  return rows.map((row) => ({
    membershipId: row.membershipId,
    arenaId: row.arenaId,
    arenaSlug: row.arenaSlug,
    arenaName: row.arenaName,
    roleKey: row.roleKey as ArenaRoleKey,
    roleName: row.roleName,
    // A membership can only ever carry arena permissions, even if someone
    // granted a platform permission to an arena role by mistake.
    permissions: (permissions.get(row.roleId) ?? []).filter((p) => !isPlatformPermission(p)),
  }))
}

/** The user's platform standing, or null for an ordinary arena user. */
export async function loadPlatformAccess(platformRoleId: string | null): Promise<PlatformAccess | null> {
  if (!platformRoleId) return null
  const database = await db()
  const role = await database.query.roles.findFirst({ where: eq(schema.roles.id, platformRoleId) })
  if (!role || role.scope !== "PLATFORM") return null
  const permissions = await permissionsByRole([role.id])
  return {
    roleKey: role.key as PlatformRoleKey,
    roleName: role.name,
    permissions: (permissions.get(role.id) ?? []).filter((p) => isPlatformPermission(p)),
  }
}

/**
 * Grants access to one arena, or throws.
 *
 * Membership is checked first and separately from the permission, so the
 * logged reason distinguishes "not a member of this arena" from "a member
 * without this permission" — the two need different responses from an
 * operator, and only one of them is an attack signal.
 */
export function authorizeArena(
  user: AuthorizableUser,
  arenaId: string,
  ...permissions: Permission[]
): ArenaAccess {
  const platformOnly = permissions.filter(isPlatformPermission)
  if (platformOnly.length > 0) {
    // A programming error, not a user error: a platform permission can never
    // be satisfied by a membership, so asking for one here would always fail
    // open or closed for the wrong reason.
    throw new AppError("INTERNAL_ERROR", `Platform permission checked against an arena: ${platformOnly.join(", ")}`)
  }

  const access = user.memberships.find((m) => m.arenaId === arenaId)
  if (!access) {
    logger.warn("authz.no_membership", { userId: user.id, arenaId })
    throw forbidden("You do not have access to this arena")
  }

  const missing = permissions.filter((p) => !access.permissions.includes(p))
  if (missing.length > 0) {
    logger.warn("authz.permission_denied", { userId: user.id, arenaId, role: access.roleKey, missing })
    throw forbidden()
  }
  return access
}

/** Grants a platform-level capability, or throws. Never satisfied by a membership. */
export function authorizePlatform(user: AuthorizableUser, ...permissions: Permission[]): PlatformAccess {
  const arenaOnly = permissions.filter((p) => !isPlatformPermission(p))
  if (arenaOnly.length > 0) {
    throw new AppError("INTERNAL_ERROR", `Arena permission checked at platform level: ${arenaOnly.join(", ")}`)
  }
  if (!user.platform) {
    logger.warn("authz.not_platform_staff", { userId: user.id })
    throw forbidden()
  }
  const missing = permissions.filter((p) => !user.platform!.permissions.includes(p))
  if (missing.length > 0) {
    logger.warn("authz.platform_permission_denied", { userId: user.id, role: user.platform.roleKey, missing })
    throw forbidden()
  }
  return user.platform
}

/** Non-throwing variant, for deciding what to render rather than what to allow. */
export function canInArena(user: AuthorizableUser, arenaId: string, permission: Permission): boolean {
  const access = user.memberships.find((m) => m.arenaId === arenaId)
  return !!access && access.permissions.includes(permission)
}

export function canOnPlatform(user: AuthorizableUser, permission: Permission): boolean {
  return !!user.platform && user.platform.permissions.includes(permission)
}
