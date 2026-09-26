import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { randomUUID } from "node:crypto"
import { and, desc, eq } from "drizzle-orm"
import { schema } from "@/server/db"
import { createTestDb } from "../helpers/db"
import { getArena, customer, getAdminUser, makeOpenSession, testActor , bookAs} from "../helpers/fixtures"
import { createBooking } from "@/server/services/bookings"
import { countPaymentsNeedingRefund, handleProviderWebhook, initializePayment, listPayments, reconcilePendingPayments, refundPayment, verifyPayment } from "@/server/services/payments"
import { getSessionById } from "@/server/services/sessions"
import { setMockOutcome } from "@/server/payments/mock"
import { __setPaymentProviderForTests } from "@/server/payments/accounts"
import type { PaymentProvider } from "@/server/payments/provider"

let ctx: Awaited<ReturnType<typeof createTestDb>>
/** Every service call in this file is scoped to the seeded arena. */
let arena: Awaited<ReturnType<typeof getArena>>
beforeAll(async () => {
  ctx = await createTestDb()
  arena = await getArena(ctx.db)
})
afterAll(async () => {
  __setPaymentProviderForTests(undefined)
  await ctx.client.close()
})

async function book(sessionId: string, i: number) {
  const { booking } = await bookAs(arena.id, i, { sessionId })
  const { payment } = await initializePayment(arena.id, booking.id)
  return { booking, payment }
}
const notificationsFor = (paymentId: string) =>
  ctx.db.query.notifications.findMany({ where: eq(schema.notifications.type, "payment.refund_required") }).then((rows) => rows.filter((r) => (r.data as { paymentId?: string } | null)?.paymentId === paymentId))

describe("paid after the hold expired and the session filled up", () => {
  it("records the charge, flags it for refund, alerts admins once, and refunds without a ticket", async () => {
    const session = await makeOpenSession(ctx.db, { teamsCount: 1, playersPerTeam: 1 })
    const late = await book(session.id, 1000)

    // The hold lapses while the customer is still on the payment page…
    await ctx.db.update(schema.bookings).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.bookings.id, late.booking.id))
    await getSessionById(arena.id, session.id) // releases the expired hold
    // …and someone else takes (and pays for) the only slot.
    const other = await book(session.id, 1001)
    await setMockOutcome(other.payment.reference, "success")
    expect((await verifyPayment(arena.id, other.payment.reference)).status).toBe("PAID")

    // Now the late payment succeeds. Callback page and webhook arrive together.
    await setMockOutcome(late.payment.reference, "success")
    const [a, b] = await Promise.all([verifyPayment(arena.id, late.payment.reference), verifyPayment(arena.id, late.payment.reference)])
    expect(a.status).toBe("REFUND_REQUIRED")
    expect(b.status).toBe("REFUND_REQUIRED")

    const payment = (await ctx.db.query.payments.findFirst({ where: eq(schema.payments.id, late.payment.id) }))!
    expect(payment.status).toBe("PAID")
    expect(payment.refundRequiredAt).not.toBeNull()
    expect(await ctx.db.query.tickets.findFirst({ where: eq(schema.tickets.bookingId, late.booking.id) })).toBeUndefined()

    const charges = await ctx.db.query.transactions.findMany({ where: and(eq(schema.transactions.paymentId, payment.id), eq(schema.transactions.type, "CHARGE")) })
    expect(charges).toHaveLength(1)
    const audit = await ctx.db.query.auditLogs.findMany({ where: and(eq(schema.auditLogs.action, "payment.refund_required"), eq(schema.auditLogs.entityId, payment.id)) })
    expect(audit).toHaveLength(1)

    const alerts = await notificationsFor(payment.id)
    expect(alerts.filter((n) => n.channel === "IN_APP")).toHaveLength(1)
    const admin = await getAdminUser(ctx.db)
    const emails = alerts.filter((n) => n.channel === "EMAIL")
    expect(emails.map((n) => n.recipientAddress)).toContain(admin.email)
    expect(emails[0].body).toContain(payment.reference)

    // Revisiting the callback page or a webhook retry does not alert again.
    expect((await verifyPayment(arena.id, late.payment.reference)).status).toBe("REFUND_REQUIRED")
    expect(await notificationsFor(payment.id)).toHaveLength(alerts.length)

    expect(await countPaymentsNeedingRefund(arena.id)).toBe(1)
    const needs = await listPayments(arena.id, { status: "NEEDS_REFUND" })
    expect(needs.items.map((r) => r.payment.id)).toEqual([payment.id])

    const refunded = await refundPayment(arena.id, payment.id, "Session full", { actor: { ...testActor, id: admin.id } })
    expect(refunded.payment.status).toBe("REFUNDED")
    expect(refunded.ticket).toBeNull()
    const refunds = await ctx.db.query.transactions.findMany({ where: and(eq(schema.transactions.paymentId, payment.id), eq(schema.transactions.type, "REFUND")) })
    expect(refunds).toHaveLength(1)
    expect(refunds[0].amount).toBe(-payment.amount)
    expect(await countPaymentsNeedingRefund(arena.id)).toBe(0)
    // The customer still sees why they were refunded, not "payment failed".
    expect((await verifyPayment(arena.id, late.payment.reference)).status).toBe("REFUND_REQUIRED")
    // The other customer's ticket is untouched.
    expect((await ctx.db.query.sessions.findFirst({ where: eq(schema.sessions.id, session.id) }))!.bookedCount).toBe(1)
  })
})

describe("reconciling stuck pending payments", () => {
  const backdate = (paymentId: string, ms: number) => ctx.db.update(schema.payments).set({ createdAt: new Date(Date.now() - ms) }).where(eq(schema.payments.id, paymentId))

  it("issues the ticket for a paid-but-unconfirmed payment and leaves fresh or ancient attempts alone", async () => {
    const session = await makeOpenSession(ctx.db, { teamsCount: 2, playersPerTeam: 4 })

    const closedTab = await book(session.id, 1100) // paid, then closed the tab; webhook never arrived
    await setMockOutcome(closedTab.payment.reference, "success")
    await backdate(closedTab.payment.id, 5 * 60_000)

    const stillPaying = await book(session.id, 1101) // on the payment page right now
    await setMockOutcome(stillPaying.payment.reference, "success")

    const declined = await book(session.id, 1102)
    await setMockOutcome(declined.payment.reference, "failed")
    await backdate(declined.payment.id, 10 * 60_000)

    const ancient = await book(session.id, 1103)
    await setMockOutcome(ancient.payment.reference, "success")
    await backdate(ancient.payment.id, 3 * 24 * 60 * 60_000)

    const summary = await reconcilePendingPayments()
    expect(summary.paid).toBeGreaterThanOrEqual(1)
    expect(summary.errors).toBe(0)

    const status = async (id: string) => (await ctx.db.query.payments.findFirst({ where: eq(schema.payments.id, id) }))!.status
    expect(await status(closedTab.payment.id)).toBe("PAID")
    expect(await ctx.db.query.tickets.findFirst({ where: eq(schema.tickets.bookingId, closedTab.booking.id) })).toBeDefined()
    expect(await status(declined.payment.id)).toBe("FAILED")
    expect(await status(stillPaying.payment.id)).toBe("PENDING")
    expect(await status(ancient.payment.id)).toBe("PENDING")
  })
})

describe("provider webhooks", () => {
  const stub = (
    event: Awaited<ReturnType<PaymentProvider["parseWebhook"]>>,
    verify: Awaited<ReturnType<PaymentProvider["verify"]>> = { status: "pending", amount: 0, currency: "NGN" }
  ): PaymentProvider => ({
    name: "stub",
    initialize: async () => ({ authorizationUrl: "https://x" }),
    verify: async () => verify,
    parseWebhook: async () => event,
    refund: async () => ({ status: "success" }),
  })

  /** A delivery for a real payment, so the handler can find its arena. */
  async function delivery(reference: string, nonce = randomUUID()) {
    return JSON.stringify({ event: "charge.success", nonce, data: { reference } })
  }

  it("acknowledges a reference it does not recognise, without revealing anything", async () => {
    // No signature check is even attempted: an unknown reference must not be
    // usable to probe which arenas exist or which keys are configured.
    await expect(handleProviderWebhook(await delivery("AP-NOSUCHREF"), new Headers())).resolves.toBeNull()
    const [event] = await ctx.db.select().from(schema.paymentEvents).orderBy(desc(schema.paymentEvents.createdAt)).limit(1)
    expect(event.outcome).toBe("unknown_reference")
    expect(event.signatureValid).toBe(false)
    expect(event.arenaId).toBeNull()
  })

  it("rejects a delivery whose signature does not verify against the arena's key", async () => {
    const session = await makeOpenSession(ctx.db)
    const { booking } = await bookAs(arena.id, 700, { sessionId: session.id })
    const { payment } = await initializePayment(arena.id, booking.id)

    __setPaymentProviderForTests(stub(null))
    await expect(handleProviderWebhook(await delivery(payment.reference), new Headers())).rejects.toMatchObject({ code: "FORBIDDEN" })
    __setPaymentProviderForTests(undefined)

    const [event] = await ctx.db.select().from(schema.paymentEvents).orderBy(desc(schema.paymentEvents.createdAt)).limit(1)
    expect(event.outcome).toBe("bad_signature")
    expect(event.arenaId).toBe(arena.id)
    expect(event.signatureValid).toBe(false)
  })

  it("acknowledges a signed event that carries nothing to verify", async () => {
    const session = await makeOpenSession(ctx.db)
    const { booking } = await bookAs(arena.id, 701, { sessionId: session.id })
    const { payment } = await initializePayment(arena.id, booking.id)

    __setPaymentProviderForTests(stub({ type: "refund.processed", raw: {} }))
    await expect(handleProviderWebhook(await delivery(payment.reference), new Headers())).resolves.toBeNull()
    __setPaymentProviderForTests(undefined)

    const [event] = await ctx.db.select().from(schema.paymentEvents).orderBy(desc(schema.paymentEvents.createdAt)).limit(1)
    expect(event.outcome).toBe("accepted")
    expect(event.eventType).toBe("refund.processed")
    expect(event.signatureValid).toBe(true)
  })

  it("processes identical bytes exactly once, however many times they arrive", async () => {
    const session = await makeOpenSession(ctx.db)
    const { booking } = await bookAs(arena.id, 702, { sessionId: session.id })
    const { payment } = await initializePayment(arena.id, booking.id)
    await setMockOutcome(payment.reference, "success")

    const body = await delivery(payment.reference)
    // The provider confirms the charge on its own API, as the real one does.
    __setPaymentProviderForTests(
      stub({ type: "charge.success", reference: payment.reference, raw: {} }, { status: "success", amount: payment.amount, currency: payment.currency, providerTransactionId: "stub-1" })
    )
    const first = await handleProviderWebhook(body, new Headers())
    expect(first?.status).toBe("PAID")

    // The same signed bytes again — a provider retry, or a captured request
    // replayed by someone else. Acknowledged, not re-processed.
    const before = await ctx.db.select().from(schema.paymentEvents)
    expect(await handleProviderWebhook(body, new Headers())).toBeNull()
    expect(await handleProviderWebhook(body, new Headers())).toBeNull()
    const after = await ctx.db.select().from(schema.paymentEvents)
    expect(after.length).toBe(before.length)
    __setPaymentProviderForTests(undefined)

    // Exactly one ticket, whatever the delivery count.
    const tickets = await ctx.db.select().from(schema.tickets).where(eq(schema.tickets.bookingId, booking.id))
    expect(tickets).toHaveLength(1)
  })
})
