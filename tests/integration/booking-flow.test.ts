import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { schema } from "@/server/db"
import { createTestDb } from "../helpers/db"
import { getArena, customer, getAdminUser, makeOpenSession, testActor } from "../helpers/fixtures"
import { createBooking, expireStaleBookings } from "@/server/services/bookings"
import { initializePayment, verifyPayment, refundPayment } from "@/server/services/payments"
import { setMockOutcome } from "@/server/payments/mock"
import { buildQrPayload, validateTicket } from "@/server/services/tickets"
import { AppError } from "@/server/http/errors"

let ctx: Awaited<ReturnType<typeof createTestDb>>
/** Every service call in this file is scoped to the seeded arena. */
let arena: Awaited<ReturnType<typeof getArena>>
beforeAll(async () => {
  ctx = await createTestDb()
  arena = await getArena(ctx.db)
})
afterAll(async () => {
  await ctx.client.close()
})

async function bookAndPay(sessionId: string, i: number) {
  const { booking } = await createBooking(arena.id, { sessionId, customer: customer(i), idempotencyKey: randomUUID() },
    { actor: { type: "customer" } }
  )
  const { payment } = await initializePayment(arena.id, booking.id)
  await setMockOutcome(payment.reference, "success")
  const outcome = await verifyPayment(arena.id, payment.reference)
  if (outcome.status !== "PAID") throw new Error(`expected PAID, got ${outcome.status}`)
  return { booking, payment, ticket: outcome.ticket }
}

describe("session capacity: 8 teams × 4 players = 32", () => {
  it("creates exactly 8 teams and 32 slots for a default session", async () => {
    const session = await makeOpenSession(ctx.db)
    const teams = await ctx.db.query.teams.findMany({ where: eq(schema.teams.sessionId, session.id) })
    const slots = await ctx.db.query.sessionSlots.findMany({ where: eq(schema.sessionSlots.sessionId, session.id) })
    expect(session.totalCapacity).toBe(32)
    expect(teams).toHaveLength(8)
    expect(slots).toHaveLength(32)
    for (let t = 1; t <= 8; t++) expect(slots.filter((s) => s.teamNumber === t)).toHaveLength(4)
  })

  it("never allocates more than 32 slots when 100 customers book simultaneously", async () => {
    const session = await makeOpenSession(ctx.db)
    const attempts = Array.from({ length: 100 }, (_, i) =>
      createBooking(arena.id, { sessionId: session.id, customer: customer(100 + i), idempotencyKey: randomUUID() }, { actor: { type: "customer" } })
    )
    const results = await Promise.allSettled(attempts)
    const ok = results.filter((r) => r.status === "fulfilled")
    const failed = results.filter((r) => r.status === "rejected")

    expect(ok).toHaveLength(32)
    expect(failed).toHaveLength(68)
    for (const f of failed) {
      expect(f.status === "rejected" && f.reason).toBeInstanceOf(AppError)
      expect(f.status === "rejected" && (f.reason as AppError).code).toBe("SESSION_FULL")
    }

    // Every successful booking holds a distinct (team, slot) position.
    const positions = new Set(ok.map((r) => r.status === "fulfilled" && `${r.value.slot.teamNumber}-${r.value.slot.slotNumber}`))
    expect(positions.size).toBe(32)

    const fresh = (await ctx.db.query.sessions.findFirst({ where: eq(schema.sessions.id, session.id) }))!
    expect(fresh.heldCount + fresh.bookedCount).toBe(32)
    const held = await ctx.db.query.sessionSlots.findMany({ where: eq(schema.sessionSlots.sessionId, session.id) })
    expect(held.filter((s) => s.status === "HELD")).toHaveLength(32)
    expect(held.filter((s) => s.status === "FREE")).toHaveLength(0)
  })

  it("balances allocation across teams (round-robin)", async () => {
    const session = await makeOpenSession(ctx.db)
    const first = []
    for (let i = 0; i < 8; i++) {
      const r = await createBooking(arena.id, { sessionId: session.id, customer: customer(200 + i), idempotencyKey: randomUUID() }, { actor: { type: "customer" } })
      first.push(r.slot)
    }
    expect(first.map((s) => s.teamNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(first.every((s) => s.slotNumber === 1)).toBe(true)
    const preferred = await createBooking(arena.id, { sessionId: session.id, customer: customer(299), idempotencyKey: randomUUID(), preferredTeamNumber: 3 }, { actor: { type: "customer" } })
    expect(preferred.slot).toEqual({ teamNumber: 3, slotNumber: 2 })
  })

  it("respects a custom team structure (5 teams × 3 players = 15)", async () => {
    const session = await makeOpenSession(ctx.db, { teamsCount: 5, playersPerTeam: 3 })
    expect(session.totalCapacity).toBe(15)
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => createBooking(arena.id, { sessionId: session.id, customer: customer(300 + i), idempotencyKey: randomUUID() }, { actor: { type: "customer" } }))
    )
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(15)
  })
})

describe("booking idempotency and hold expiry", () => {
  it("returns the same booking for a repeated idempotency key", async () => {
    const session = await makeOpenSession(ctx.db)
    const key = randomUUID()
    const a = await createBooking(arena.id, { sessionId: session.id, customer: customer(400), idempotencyKey: key }, { actor: { type: "customer" } })
    const b = await createBooking(arena.id, { sessionId: session.id, customer: customer(400), idempotencyKey: key }, { actor: { type: "customer" } })
    expect(b.booking.id).toBe(a.booking.id)
    expect(b.reused).toBe(true)
    const fresh = (await ctx.db.query.sessions.findFirst({ where: eq(schema.sessions.id, session.id) }))!
    expect(fresh.heldCount).toBe(1)
  })

  it("releases expired holds so the slot can be re-booked", async () => {
    const session = await makeOpenSession(ctx.db, { teamsCount: 1, playersPerTeam: 1 })
    const first = await createBooking(arena.id, { sessionId: session.id, customer: customer(500), idempotencyKey: randomUUID() }, { actor: { type: "customer" } })
    await expect(
      createBooking(arena.id, { sessionId: session.id, customer: customer(501), idempotencyKey: randomUUID() }, { actor: { type: "customer" } })
    ).rejects.toMatchObject({ code: "SESSION_FULL" })

    // Simulate the hold timing out.
    await ctx.db.update(schema.bookings).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.bookings.id, first.booking.id))
    const { released } = await expireStaleBookings()
    expect(released).toBe(1)

    const second = await createBooking(arena.id, { sessionId: session.id, customer: customer(501), idempotencyKey: randomUUID() }, { actor: { type: "customer" } })
    expect(second.slot).toEqual({ teamNumber: 1, slotNumber: 1 })
    const expired = (await ctx.db.query.bookings.findFirst({ where: eq(schema.bookings.id, first.booking.id) }))!
    expect(expired.status).toBe("EXPIRED")
  })

  it("rejects bookings outside the window and for drafts", async () => {
    const closed = await makeOpenSession(ctx.db, { bookingOpensAt: new Date(Date.now() - 7_200_000), bookingDeadline: new Date(Date.now() - 3_600_000) })
    await expect(createBooking(arena.id, { sessionId: closed.id, customer: customer(600), idempotencyKey: randomUUID() }, { actor: { type: "customer" } })).rejects.toMatchObject({ code: "BOOKING_CLOSED" })
    const notYet = await makeOpenSession(ctx.db, { bookingOpensAt: new Date(Date.now() + 3_600_000), bookingDeadline: new Date(Date.now() + 5 * 3_600_000) })
    await expect(createBooking(arena.id, { sessionId: notYet.id, customer: customer(601), idempotencyKey: randomUUID() }, { actor: { type: "customer" } })).rejects.toMatchObject({ code: "BOOKING_NOT_OPEN" })
    const draft = await makeOpenSession(ctx.db, { publish: false })
    await expect(createBooking(arena.id, { sessionId: draft.id, customer: customer(602), idempotencyKey: randomUUID() }, { actor: { type: "customer" } })).rejects.toMatchObject({ code: "SESSION_NOT_BOOKABLE" })
  })
})

describe("payment verification issues exactly one ticket", () => {
  it("confirms the booking, issues a ticket once, and marks the session FULL at capacity", async () => {
    const session = await makeOpenSession(ctx.db, { teamsCount: 1, playersPerTeam: 2 })
    const { payment, ticket } = await bookAndPay(session.id, 700)
    expect(ticket.ticketNumber).toMatch(/^AP-\d{4}-\d{6}$/)
    expect(ticket.status).toBe("CONFIRMED")

    // Re-verifying (callback + webhook + refresh) must not create a second ticket.
    const again = await verifyPayment(arena.id, payment.reference)
    expect(again.status).toBe("PAID")
    expect(again.status === "PAID" && again.ticket.id).toBe(ticket.id)
    const tickets = await ctx.db.query.tickets.findMany({ where: eq(schema.tickets.bookingId, ticket.bookingId) })
    expect(tickets).toHaveLength(1)

    let s = (await ctx.db.query.sessions.findFirst({ where: eq(schema.sessions.id, session.id) }))!
    expect(s.bookedCount).toBe(1)
    expect(s.heldCount).toBe(0)

    await bookAndPay(session.id, 701)
    s = (await ctx.db.query.sessions.findFirst({ where: eq(schema.sessions.id, session.id) }))!
    expect(s.bookedCount).toBe(2)
    expect(s.status).toBe("FULL")

    const charges = await ctx.db.query.transactions.findMany({ where: eq(schema.transactions.paymentId, payment.id) })
    expect(charges).toHaveLength(1)
    expect(charges[0].type).toBe("CHARGE")
  })

  it("does not confirm a failed or pending payment", async () => {
    const session = await makeOpenSession(ctx.db)
    const { booking } = await createBooking(arena.id, { sessionId: session.id, customer: customer(710), idempotencyKey: randomUUID() }, { actor: { type: "customer" } })
    const { payment } = await initializePayment(arena.id, booking.id)
    expect((await verifyPayment(arena.id, payment.reference)).status).toBe("PENDING")
    await setMockOutcome(payment.reference, "failed")
    expect((await verifyPayment(arena.id, payment.reference)).status).toBe("FAILED")
    const b = (await ctx.db.query.bookings.findFirst({ where: eq(schema.bookings.id, booking.id) }))!
    expect(b.status).toBe("PENDING")
    expect(await ctx.db.query.tickets.findFirst({ where: eq(schema.tickets.bookingId, booking.id) })).toBeUndefined()
  })

  it("reuses the pending payment on repeated initialize calls", async () => {
    const session = await makeOpenSession(ctx.db)
    const { booking } = await createBooking(arena.id, { sessionId: session.id, customer: customer(720), idempotencyKey: randomUUID() }, { actor: { type: "customer" } })
    const a = await initializePayment(arena.id, booking.id)
    const b = await initializePayment(arena.id, booking.id)
    expect(b.payment.id).toBe(a.payment.id)
  })
})

describe("ticket validation", () => {
  it("admits a valid ticket once and rejects the second scan", async () => {
    const session = await makeOpenSession(ctx.db)
    const { ticket } = await bookAndPay(session.id, 800)
    const admin = await getAdminUser(ctx.db)
    const actor = { ...testActor, id: admin.id }
    const payload = buildQrPayload(arena.id, ticket.qrToken)

    const check = await validateTicket(arena.id, payload, { mode: "check", actor })
    expect(check.result).toBe("VALID")

    const admit = await validateTicket(arena.id, payload, { mode: "admit", actor })
    expect(admit.result).toBe("VALID")
    expect(admit.result === "VALID" && admit.ticket.ticket.status).toBe("USED")

    const again = await validateTicket(arena.id, payload, { mode: "admit", actor })
    expect(again.result).toBe("ALREADY_USED")

    const byNumber = await validateTicket(arena.id, ticket.ticketNumber, { mode: "check", actor })
    expect(byNumber.result).toBe("ALREADY_USED")
  })

  it("rejects forged payloads and wrong-session scans", async () => {
    const session = await makeOpenSession(ctx.db)
    const other = await makeOpenSession(ctx.db, { title: "Other" })
    const { ticket } = await bookAndPay(session.id, 810)
    const admin = await getAdminUser(ctx.db)
    const actor = { ...testActor, id: admin.id }
    expect((await validateTicket(arena.id, `AP1.${ticket.qrToken}.forgedsignature000000`, { mode: "admit", actor })).result).toBe("INVALID")
    expect((await validateTicket(arena.id, "garbage", { mode: "admit", actor })).result).toBe("INVALID")
    expect((await validateTicket(arena.id, buildQrPayload(arena.id, ticket.qrToken), { mode: "admit", actor, expectedSessionId: other.id })).result).toBe("WRONG_SESSION")
    const t = (await ctx.db.query.tickets.findFirst({ where: eq(schema.tickets.id, ticket.id) }))!
    expect(t.status).toBe("CONFIRMED")
  })
})

describe("refunds", () => {
  it("refunds a paid ticket, frees the slot and records a ledger entry", async () => {
    const session = await makeOpenSession(ctx.db, { teamsCount: 1, playersPerTeam: 1 })
    const { payment, ticket } = await bookAndPay(session.id, 900)
    const admin = await getAdminUser(ctx.db)
    const result = await refundPayment(arena.id, payment.id, "Customer request", { actor: { ...testActor, id: admin.id } })
    expect(result.ticket?.status).toBe("REFUNDED")
    expect(result.payment.status).toBe("REFUNDED")
    const s = (await ctx.db.query.sessions.findFirst({ where: eq(schema.sessions.id, session.id) }))!
    expect(s.bookedCount).toBe(0)
    expect(s.status).toBe("OPEN_FOR_BOOKING")
    const slot = (await ctx.db.query.sessionSlots.findFirst({ where: eq(schema.sessionSlots.id, ticket.slotId!) }))!
    expect(slot.status).toBe("FREE")
    const ledger = await ctx.db.query.transactions.findMany({ where: eq(schema.transactions.paymentId, payment.id) })
    expect(ledger.map((l) => l.type).sort()).toEqual(["CHARGE", "REFUND"])
    const admin2 = await getAdminUser(ctx.db)
    expect((await validateTicket(arena.id, buildQrPayload(arena.id, ticket.qrToken), { mode: "admit", actor: { ...testActor, id: admin2.id } })).result).toBe("NOT_VALID")
    // Slot is bookable again.
    const rebook = await createBooking(arena.id, { sessionId: session.id, customer: customer(901), idempotencyKey: randomUUID() }, { actor: { type: "customer" } })
    expect(rebook.slot).toEqual({ teamNumber: 1, slotNumber: 1 })
  })
})
