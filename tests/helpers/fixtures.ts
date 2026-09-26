import { randomUUID } from "node:crypto"
import { and, eq, isNotNull } from "drizzle-orm"
import { schema, type Database } from "@/server/db"
import { createSession } from "@/server/services/sessions"
import type { AuditActor } from "@/server/services/audit"

export const testActor: AuditActor & { id: string } = { type: "user", id: randomUUID(), name: "Test Admin" }

/**
 * A second tenant, shaped the way registration shapes one: an organization, an
 * arena, and an owner. Without the owner the arena would be unreachable, which
 * is a state the product never produces and the invariant suite rejects.
 */
export async function makeArena(db: Database, slug: string, overrides: Partial<typeof schema.arenas.$inferInsert> = {}) {
  const [organization] = await db.insert(schema.organizations).values({ slug, name: slug, status: "ACTIVE" }).returning()
  const [arena] = await db
    .insert(schema.arenas)
    .values({ slug, name: slug, organizationId: organization.id, status: "ACTIVE", onboardingStep: "launched", ...overrides })
    .returning()
  const ownerRole = (await db.query.roles.findFirst({ where: eq(schema.roles.key, "ARENA_OWNER") }))!
  const [owner] = await db
    .insert(schema.users)
    .values({ name: `${slug} owner`, email: `owner@${slug}.fixture`, passwordHash: "x" })
    .returning()
  await db
    .insert(schema.arenaMemberships)
    .values({ arenaId: arena.id, userId: owner.id, roleId: ownerRole.id, status: "ACTIVE", acceptedAt: new Date() })
  return arena
}

export async function getArena(db: Database) {
  return (await db.query.arenas.findFirst({ where: eq(schema.arenas.slug, "main") }))!
}

/**
 * The default arena's own owner — an arena operator, with no platform role.
 *
 * Deliberately not "the first user": that used to be the bootstrap account,
 * which held a platform role *and* an arena membership. The two are separate
 * people now, and a test that wants an arena actor wants this one.
 */
export async function getAdminUser(db: Database) {
  const arena = await getArena(db)
  const [row] = await db
    .select({ user: schema.users })
    .from(schema.arenaMemberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.arenaMemberships.userId))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.arenaMemberships.roleId))
    .where(and(eq(schema.arenaMemberships.arenaId, arena.id), eq(schema.roles.key, "ARENA_OWNER")))
    .limit(1)
  return row.user
}

/** The platform operator, who is a member of no arena at all. */
export async function getPlatformUser(db: Database) {
  return (await db.query.users.findFirst({ where: isNotNull(schema.users.platformRoleId) }))!
}

export async function makeOpenSession(db: Database, overrides: Partial<Parameters<typeof createSession>[0]> = {}) {
  const arena = await getArena(db)
  const admin = await getAdminUser(db)
  const now = Date.now()
  return createSession(
    {
      title: "Friday Night Football",
      venue: "Pitch A",
      startsAt: new Date(now + 6 * 3_600_000),
      endsAt: new Date(now + 8 * 3_600_000),
      bookingOpensAt: new Date(now - 3_600_000),
      bookingDeadline: new Date(now + 5 * 3_600_000),
      teamsCount: 8,
      playersPerTeam: 4,
      ticketPriceMajor: 5000,
      publish: true,
      ...overrides,
    },
    { arenaId: arena.id, actor: { type: "user", id: admin.id, name: admin.name } }
  )
}

export function customer(i: number) {
  return { name: `Player ${i}`, email: `player${i}@example.com`, phone: "" }
}
