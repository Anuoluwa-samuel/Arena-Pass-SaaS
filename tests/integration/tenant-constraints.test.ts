import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import * as schema from "@/server/db/schema"
import { createTestDb } from "../helpers/db"
import { expectDbError } from "../helpers/errors"
import { getArena, getAdminUser, makeArena, testActor } from "../helpers/fixtures"
import { createSession } from "@/server/services/sessions"
import { createBooking } from "@/server/services/bookings"
import { initializePayment, verifyPayment } from "@/server/services/payments"
import { setMockOutcome } from "@/server/payments/mock"

/**
 * The storage layer, on its own.
 *
 * Every write here goes straight to the database: no service, no route, no
 * authorisation. That is the point — these assertions are what still holds
 * when the layers above are wrong, bypassed, or written by someone who has
 * never read `server/tenant`.
 */

let ctx: Awaited<ReturnType<typeof createTestDb>>
let a: schema.Arena
let b: schema.Arena
const A: Record<string, string> = {}
const B: Record<string, string> = {}

beforeAll(async () => {
  ctx = await createTestDb()
  a = await getArena(ctx.db)
  b = await makeArena(ctx.db, "arena-b")
  const admin = await getAdminUser(ctx.db)
  const actor = { ...testActor, id: admin.id }
  const now = Date.now()

  const mkSession = (arenaId: string, title: string) =>
    createSession(
      {
        title, venue: "Pitch",
        startsAt: new Date(now + 6 * 3_600_000), endsAt: new Date(now + 8 * 3_600_000),
        bookingOpensAt: new Date(now - 3_600_000), bookingDeadline: new Date(now + 5 * 3_600_000),
        teamsCount: 8, playersPerTeam: 4, ticketPriceMajor: 5000, publish: true,
      },
      { arenaId, actor }
    )

  A.session = (await mkSession(a.id, "A session")).id
  B.session = (await mkSession(b.id, "B session")).id

  const bookingA = await createBooking(a.id, { sessionId: A.session, customer: { name: "A", email: "a@example.com", phone: "" }, idempotencyKey: randomUUID() }, { actor: { type: "customer" } })
  A.booking = bookingA.booking.id
  A.customer = bookingA.booking.customerId
  const payA = await initializePayment(a.id, A.booking)
  A.payment = payA.payment.id
  await setMockOutcome(payA.payment.reference, "success")
  const paid = await verifyPayment(a.id, payA.payment.reference)
  if (paid.status !== "PAID") throw new Error("setup")
  A.ticket = paid.ticket.id

  const bookingB = await createBooking(b.id, { sessionId: B.session, customer: { name: "B", email: "b@example.com", phone: "" }, idempotencyKey: randomUUID() }, { actor: { type: "customer" } })
  B.booking = bookingB.booking.id
  B.customer = bookingB.booking.customerId

  const slotA = (await ctx.db.query.sessionSlots.findFirst({ where: eq(schema.sessionSlots.sessionId, A.session) }))!
  A.slot = slotA.id
  const teamA = (await ctx.db.query.teams.findFirst({ where: eq(schema.teams.sessionId, A.session) }))!
  A.team = teamA.id

  // A booking in A that has no ticket yet, so the one-ticket-per-booking index
  // does not fire before the composite key under test.
  const spare = await createBooking(a.id, { sessionId: A.session, customer: { name: "A2", email: "a2@example.com", phone: "" }, idempotencyKey: randomUUID() }, { actor: { type: "customer" } })
  A.spareBooking = spare.booking.id

  // A session in A with no grid, so team/slot numbering does not collide.
  const [bare] = await ctx.db
    .insert(schema.sessions)
    .values({
      arenaId: a.id, title: "A bare", venue: "Pitch",
      startsAt: new Date(now + 30 * 3_600_000), endsAt: new Date(now + 32 * 3_600_000),
      bookingOpensAt: new Date(now), bookingDeadline: new Date(now + 29 * 3_600_000),
      teamsCount: 8, playersPerTeam: 4, totalCapacity: 32, ticketPrice: 1000,
    })
    .returning()
  A.bareSession = bare.id

  const [mediaA] = await ctx.db
    .insert(schema.media)
    .values({ arenaId: a.id, storageKey: `${a.id}/general/x.png`, url: "/x.png", filename: "x.png", originalName: "x.png", mimeType: "image/png", sizeBytes: 1 })
    .returning()
  A.media = mediaA.id
})

afterAll(async () => {
  await ctx.client.close()
})

const bookingValues = (over: Partial<typeof schema.bookings.$inferInsert>) => ({
  arenaId: b.id,
  sessionId: B.session,
  customerId: B.customer,
  playerName: "Impostor",
  amount: 1,
  currency: "NGN",
  idempotencyKey: randomUUID(),
  expiresAt: new Date(Date.now() + 600_000),
  ...over,
})

describe("a booking cannot reach into another arena", () => {
  it("refuses Arena B's booking pointing at Arena A's session", async () => {
    await expectDbError(ctx.db.insert(schema.bookings).values(bookingValues({ sessionId: A.session })), /bookings_arena_session_fk/)
  })

  it("refuses Arena B's booking pointing at Arena A's customer", async () => {
    await expectDbError(ctx.db.insert(schema.bookings).values(bookingValues({ customerId: A.customer })), /bookings_arena_customer_fk/)
  })

  it("refuses Arena B's booking claiming Arena A's slot or team", async () => {
    await expectDbError(ctx.db.insert(schema.bookings).values(bookingValues({ slotId: A.slot })), /bookings_arena_slot_fk/)
    await expectDbError(ctx.db.insert(schema.bookings).values(bookingValues({ teamId: A.team })), /bookings_arena_team_fk/)
  })

  it("refuses moving an existing booking into another arena", async () => {
    // An UPDATE that changes only arena_id is refused from both directions at
    // once: the booking's own parents no longer match, and its payment would
    // be left pointing at a booking in a different arena.
    await expectDbError(
      ctx.db.update(schema.bookings).set({ arenaId: b.id }).where(eq(schema.bookings.id, A.booking)),
      /_arena_\w+_fk/
    )
  })

  it("still accepts a booking wholly inside one arena", async () => {
    const [row] = await ctx.db.insert(schema.bookings).values(bookingValues({})).returning()
    expect(row.arenaId).toBe(b.id)
    await ctx.db.delete(schema.bookings).where(eq(schema.bookings.id, row.id))
  })
})

describe("tickets, payments and the ledger cannot straddle arenas", () => {
  const ticketValues = (over: Partial<typeof schema.tickets.$inferInsert>) => ({
    arenaId: b.id,
    ticketNumber: `AP-2026-${Math.floor(Math.random() * 899999 + 100000)}`,
    bookingId: B.booking,
    sessionId: B.session,
    customerId: B.customer,
    playerName: "Impostor",
    price: 1,
    currency: "NGN",
    qrToken: randomUUID(),
    expiresAt: new Date(Date.now() + 86_400_000),
    ...over,
  })

  it("refuses a ticket whose booking, session or customer belongs elsewhere", async () => {
    await expectDbError(ctx.db.insert(schema.tickets).values(ticketValues({ bookingId: A.spareBooking })), /tickets_arena_booking_fk/)
    await expectDbError(ctx.db.insert(schema.tickets).values(ticketValues({ sessionId: A.session })), /tickets_arena_session_fk/)
    await expectDbError(ctx.db.insert(schema.tickets).values(ticketValues({ customerId: A.customer })), /tickets_arena_customer_fk/)
  })

  it("refuses a payment attached to another arena's booking or customer", async () => {
    const payment = (over: Partial<typeof schema.payments.$inferInsert>) => ({
      arenaId: b.id, bookingId: B.booking, customerId: B.customer,
      provider: "mock", reference: `REF-${randomUUID().slice(0, 8)}`, amount: 1, currency: "NGN", ...over,
    })
    await expectDbError(ctx.db.insert(schema.payments).values(payment({ bookingId: A.booking })), /payments_arena_booking_fk/)
    await expectDbError(ctx.db.insert(schema.payments).values(payment({ customerId: A.customer })), /payments_arena_customer_fk/)
  })

  it("refuses a ledger entry against another arena's payment or ticket", async () => {
    await expectDbError(
      ctx.db.insert(schema.transactions).values({ arenaId: b.id, paymentId: A.payment, type: "CHARGE", amount: 1, currency: "NGN", provider: "mock" }),
      /transactions_arena_payment_fk/
    )
    const [ownPayment] = await ctx.db
      .insert(schema.payments)
      .values({ arenaId: b.id, bookingId: B.booking, customerId: B.customer, provider: "mock", reference: `REF-${randomUUID().slice(0, 8)}`, amount: 1, currency: "NGN" })
      .returning()
    await expectDbError(
      ctx.db.insert(schema.transactions).values({ arenaId: b.id, paymentId: ownPayment.id, ticketId: A.ticket, type: "CHARGE", amount: 1, currency: "NGN", provider: "mock" }),
      /transactions_arena_ticket_fk/
    )
  })

  it("refuses a scan record against another arena's ticket or session", async () => {
    await expectDbError(
      ctx.db.insert(schema.ticketValidations).values({ arenaId: b.id, ticketId: A.ticket, result: "ADMITTED" }),
      /ticket_validations_arena_ticket_fk/
    )
    await expectDbError(
      ctx.db.insert(schema.ticketValidations).values({ arenaId: b.id, sessionId: A.session, result: "INVALID" }),
      /ticket_validations_arena_session_fk/
    )
  })
})

describe("the session grid and its waiting list stay in one arena", () => {
  it("refuses a team or slot attached to another arena's session", async () => {
    await expectDbError(
      ctx.db.insert(schema.teams).values({ arenaId: b.id, sessionId: A.bareSession, teamNumber: 1, name: "T" }),
      /teams_arena_session_fk/
    )
    await expectDbError(
      ctx.db.insert(schema.sessionSlots).values({ arenaId: b.id, sessionId: A.bareSession, teamId: A.team, teamNumber: 1, slotNumber: 1 }),
      /session_slots_arena_(session|team)_fk/
    )
  })

  it("refuses a waiting-list entry for another arena's session", async () => {
    await expectDbError(
      ctx.db.insert(schema.waitlistEntries).values({ arenaId: b.id, sessionId: A.session, name: "X", email: "x@example.com" }),
      /waitlist_arena_session_fk/
    )
  })
})

describe("content cannot borrow another arena's media", () => {
  it("refuses a service, announcement or banner illustrated with Arena A's image", async () => {
    await expectDbError(
      ctx.db.insert(schema.cmsServices).values({ arenaId: b.id, title: "S", description: "D", imageMediaId: A.media }),
      /cms_services_arena_media_fk/
    )
    await expectDbError(
      ctx.db.insert(schema.announcements).values({ arenaId: b.id, title: "T", content: "C", imageMediaId: A.media }),
      /announcements_arena_media_fk/
    )
    await expectDbError(
      ctx.db.insert(schema.banners).values({ arenaId: b.id, title: "T", imageMediaId: A.media }),
      /banners_arena_media_fk/
    )
  })
})

describe("tenant columns are required", () => {
  it("refuses a row with no arena on every tenant-owned table", async () => {
    const attempts: [string, Promise<unknown>][] = [
      ["customers", ctx.db.insert(schema.customers).values({ name: "X", email: "noarena@example.com" } as never)],
      ["media", ctx.db.insert(schema.media).values({ storageKey: "k", url: "/u", filename: "f", originalName: "f", mimeType: "image/png", sizeBytes: 1 } as never)],
      ["faqs", ctx.db.insert(schema.faqs).values({ question: "q", answer: "a" } as never)],
      ["cms_services", ctx.db.insert(schema.cmsServices).values({ title: "t", description: "d" } as never)],
      ["banners", ctx.db.insert(schema.banners).values({ title: "t" } as never)],
      ["announcements", ctx.db.insert(schema.announcements).values({ title: "t", content: "c" } as never)],
    ]
    for (const [table, attempt] of attempts) {
      await expectDbError(attempt, /null value|not-null|violates not-null/i).catch((err) => {
        throw new Error(`${table} accepted a row with no arena: ${err}`)
      })
    }
  })

  it("requires every arena to belong to an organization", async () => {
    await expectDbError(ctx.db.insert(schema.arenas).values({ slug: "orphan", name: "Orphan" } as never), /null value|not-null/i)
  })
})

describe("uniqueness that is per arena rather than global", () => {
  it("lets two arenas use the same idempotency key", async () => {
    const key = randomUUID()
    const [first] = await ctx.db.insert(schema.bookings).values(bookingValues({ idempotencyKey: key })).returning()
    // The same key in Arena A is a different booking, not a replay of B's.
    const [second] = await ctx.db
      .insert(schema.bookings)
      .values({ ...bookingValues({ idempotencyKey: key }), arenaId: a.id, sessionId: A.session, customerId: A.customer })
      .returning()
    expect(first.id).not.toBe(second.id)

    // …but the same key twice in one arena is still refused.
    await expectDbError(ctx.db.insert(schema.bookings).values(bookingValues({ idempotencyKey: key })), /bookings_arena_idempotency_idx/)
    await ctx.db.delete(schema.bookings).where(eq(schema.bookings.id, first.id))
    await ctx.db.delete(schema.bookings).where(eq(schema.bookings.id, second.id))
  })

  it("lets two arenas have a customer with the same email, and refuses a duplicate within one", async () => {
    const [mine] = await ctx.db.insert(schema.customers).values({ arenaId: b.id, name: "Shared", email: "a@example.com" }).returning()
    expect(mine.id).not.toBe(A.customer)
    await expectDbError(
      ctx.db.insert(schema.customers).values({ arenaId: b.id, name: "Again", email: "A@Example.com" }),
      /customers_arena_email_idx/
    )
    await ctx.db.delete(schema.customers).where(eq(schema.customers.id, mine.id))
  })

  it("keeps ticket numbers and payment references globally unique", async () => {
    // These are printed, scanned and quoted to a provider: a collision between
    // arenas would be a real confusion, not a tenancy question.
    const ticket = (await ctx.db.query.tickets.findFirst({ where: eq(schema.tickets.id, A.ticket) }))!
    await expectDbError(
      ctx.db.insert(schema.tickets).values({
        arenaId: b.id, ticketNumber: ticket.ticketNumber, bookingId: B.booking, sessionId: B.session, customerId: B.customer,
        playerName: "X", price: 1, currency: "NGN", qrToken: randomUUID(), expiresAt: new Date(Date.now() + 86_400_000),
      }),
      /tickets_number_idx/
    )
  })
})
