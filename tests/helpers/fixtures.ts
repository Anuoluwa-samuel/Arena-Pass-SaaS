import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
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

export async function getAdminUser(db: Database) {
  return (await db.query.users.findFirst())!
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
