import { randomUUID } from "node:crypto"
import { and, eq, isNotNull } from "drizzle-orm"
import { schema, type Database } from "@/server/db"
import { createSession } from "@/server/services/sessions"
import { createBooking } from "@/server/services/bookings"
import { upsertCustomerByEmail } from "@/server/services/customers"
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

/**
 * The account a booking is made from.
 *
 * Booking requires one: the service takes a `customerId` and the route reads it
 * from the signed-in session, so a test that wants to book has to have an
 * account first — exactly as a person does.
 */
export async function customerAccount(arenaId: string, i: number) {
  return upsertCustomerByEmail(arenaId, customer(i))
}

/** Books from a named account, for tests that care who the customer is. */
export async function bookInline(
  arenaId: string,
  who: { name: string; email: string; phone?: string },
  input: Omit<Parameters<typeof createBooking>[1], "idempotencyKey"> & { idempotencyKey?: string }
) {
  const account = await upsertCustomerByEmail(arenaId, { phone: "", ...who })
  return createBooking(
    arenaId,
    { idempotencyKey: randomUUID(), ...input },
    { actor: { type: "customer", id: account.id, name: account.name }, customerId: account.id }
  )
}

/** Creates the account and books in one step, for tests about the booking. */
export async function bookAs(
  arenaId: string,
  i: number,
  input: Omit<Parameters<typeof createBooking>[1], "idempotencyKey"> & { idempotencyKey?: string }
) {
  const account = await customerAccount(arenaId, i)
  return createBooking(
    arenaId,
    { idempotencyKey: randomUUID(), ...input },
    { actor: { type: "customer", id: account.id, name: account.name }, customerId: account.id }
  )
}
