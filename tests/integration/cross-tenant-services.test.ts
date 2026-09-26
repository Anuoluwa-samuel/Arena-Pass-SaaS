import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import * as schema from "@/server/db/schema"
import { createSession, getSessionById, getSessionWithTeams, listSessions, updateSession, publishSession, unpublishSession, cancelSession, deleteSession, joinWaitlist } from "@/server/services/sessions"
import { createBooking, getBookingById, cancelPendingBooking, listBookingsForSession } from "@/server/services/bookings"
import { initializePayment, verifyPayment, listPayments, listTransactions, refundPayment, countPaymentsNeedingRefund } from "@/server/services/payments"
import { getTicketById, listTickets, validateTicket, cancelTicket, buildQrPayload } from "@/server/services/tickets"
import { listCustomers, getCustomerDetail, updateCustomer, upsertCustomerByEmail } from "@/server/services/customers"
import { listMedia, getMedia, updateMedia, deleteMedia } from "@/server/services/media"
import { createFaq, listFaqs, updateFaq, deleteFaq, createService, updateService, deleteService, createAnnouncement, updateAnnouncement, deleteAnnouncement, createBanner, updateBanner, deleteBanner, getPage, saveDraft } from "@/server/services/cms"
import { listNotifications, markRead, notify } from "@/server/services/notifications"
import { listAuditLogs, getDashboardOverview } from "@/server/services/analytics"
import { setMockOutcome } from "@/server/payments/mock"
import { createTestDb } from "../helpers/db"
import { getArena, getAdminUser, testActor , bookInline} from "../helpers/fixtures"

/**
 * The cross-tenant matrix for the service layer.
 *
 * Arena A is fully populated — a session, a booking, a payment, a ticket, a
 * customer, media, CMS rows, a notification. Every read and write is then
 * attempted *from Arena B with Arena A's ids*. None of them may succeed, and
 * none of them may reveal that the id exists.
 */

let ctx: Awaited<ReturnType<typeof createTestDb>>
let a: schema.Arena
let b: schema.Arena
let adminId: string

/** Everything Arena A owns, by id, for Arena B to try its luck with. */
const A: Record<string, string> = {}

beforeAll(async () => {
  ctx = await createTestDb()
  a = await getArena(ctx.db)
  adminId = (await getAdminUser(ctx.db)).id

  const [org] = await ctx.db.insert(schema.organizations).values({ slug: "arena-b", name: "Arena B", status: "ACTIVE" }).returning()
  ;[b] = await ctx.db
    .insert(schema.arenas)
    .values({ slug: "arena-b", name: "Arena B", organizationId: org.id, status: "ACTIVE", onboardingStep: "launched" })
    .returning()

  const actor = { ...testActor, id: adminId }
  const now = Date.now()
  const session = await createSession(
    {
      title: "A's Session",
      venue: "Pitch A",
      startsAt: new Date(now + 6 * 3_600_000),
      endsAt: new Date(now + 8 * 3_600_000),
      bookingOpensAt: new Date(now - 3_600_000),
      bookingDeadline: new Date(now + 5 * 3_600_000),
      teamsCount: 8,
      playersPerTeam: 4,
      ticketPriceMajor: 5000,
      publish: true,
    },
    { arenaId: a.id, actor }
  )
  A.session = session.id

  const { booking } = await bookInline(a.id, { name: "A Player", email: "a.player@example.com", phone: "" }, { sessionId: session.id })
  A.booking = booking.id
  A.customer = booking.customerId

  const { payment } = await initializePayment(a.id, booking.id)
  A.payment = payment.id
  A.reference = payment.reference
  await setMockOutcome(payment.reference, "success")
  const outcome = await verifyPayment(a.id, payment.reference)
  if (outcome.status !== "PAID") throw new Error("setup: expected PAID")
  A.ticket = outcome.ticket.id
  A.qr = buildQrPayload(a.id, outcome.ticket.qrToken)
  A.ticketNumber = outcome.ticket.ticketNumber

  const [media] = await ctx.db
    .insert(schema.media)
    .values({ arenaId: a.id, storageKey: "a/logo.png", url: "/a/logo.png", filename: "logo.png", originalName: "logo.png", mimeType: "image/png", sizeBytes: 10 })
    .returning()
  A.media = media.id

  A.faq = (await createFaq(a.id, { question: "A question?", answer: "A answer", isPublished: true }, { actor })).id
  A.service = (await createService(a.id, { title: "A service", description: "A", isPublished: true }, { actor })).id
  A.announcement = (await createAnnouncement(a.id, { title: "A news", content: "A", status: "PUBLISHED" }, { actor })).id
  A.banner = (await createBanner(a.id, { title: "A banner", isActive: true }, { actor })).id

  const notification = await notify({ arenaId: a.id, recipientType: "customer", recipientAddress: "a.player@example.com", channel: "EMAIL", type: "test", title: "A", body: "A" })
  A.notification = notification!.id
})

afterAll(async () => {
  await ctx.client.close()
})

const actorB = () => ({ ...testActor, id: adminId })

describe("reads: Arena B asking for Arena A's rows", () => {
  it("cannot read the session", async () => {
    await expect(getSessionById(b.id, A.session)).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" })
    await expect(getSessionWithTeams(b.id, A.session)).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" })
  })

  it("cannot read the booking", async () => {
    await expect(getBookingById(b.id, A.booking)).rejects.toMatchObject({ code: "BOOKING_NOT_FOUND" })
  })

  it("cannot read the ticket", async () => {
    await expect(getTicketById(b.id, A.ticket)).rejects.toMatchObject({ code: "TICKET_NOT_FOUND" })
  })

  it("cannot read the customer", async () => {
    await expect(getCustomerDetail(b.id, A.customer)).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("cannot read the media item", async () => {
    await expect(getMedia(b.id, A.media)).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("sees none of Arena A's rows in any listing", async () => {
    expect((await listSessions({ arenaId: b.id })).items).toHaveLength(0)
    expect((await listBookingsForSession(b.id, A.session))).toHaveLength(0)
    expect((await listTickets(b.id)).items).toHaveLength(0)
    expect((await listCustomers(b.id)).items).toHaveLength(0)
    expect((await listPayments(b.id)).items).toHaveLength(0)
    expect((await listTransactions(b.id)).items).toHaveLength(0)
    expect((await listMedia(b.id)).items).toHaveLength(0)
    expect((await listFaqs(b.id))).toHaveLength(0)
    expect((await listNotifications(b.id)).items).toHaveLength(0)
    expect((await listAuditLogs(b.id)).items).toHaveLength(0)
    expect(await countPaymentsNeedingRefund(b.id)).toBe(0)
  })

  it("reports zero revenue and zero tickets, not Arena A's", async () => {
    const overview = await getDashboardOverview(b.id)
    expect(overview.kpis.periodRevenue).toBe(0)
    expect(overview.kpis.periodTickets).toBe(0)
  })

  it("still sees its own rows, so the filter is not simply matching nothing", async () => {
    expect((await listSessions({ arenaId: a.id })).items.length).toBeGreaterThan(0)
    expect((await listTickets(a.id)).items).toHaveLength(1)
    expect((await listCustomers(a.id)).items).toHaveLength(1)
    expect((await getDashboardOverview(a.id)).kpis.periodTickets).toBe(1)
  })
})

describe("writes: Arena B acting on Arena A's rows", () => {
  it("cannot publish, unpublish, cancel or delete the session", async () => {
    await expect(publishSession(b.id, A.session, { actor: actorB() })).rejects.toMatchObject({ code: "CONFLICT" })
    await expect(unpublishSession(b.id, A.session, { actor: actorB() })).rejects.toMatchObject({ code: "CONFLICT" })
    await expect(cancelSession(b.id, A.session, "nope", { actor: actorB() })).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" })
    await expect(deleteSession(b.id, A.session, { actor: actorB() })).rejects.toMatchObject({ code: "CONFLICT" })

    // …and Arena A's session is untouched.
    const still = await getSessionById(a.id, A.session)
    expect(still.status).toBe("PUBLISHED")
    expect(still.cancelledAt).toBeNull()
    expect(still.deletedAt).toBeNull()
  })

  it("cannot edit the session", async () => {
    await expect(
      updateSession(b.id, A.session, {
        title: "Hijacked", venue: "X",
        startsAt: new Date(Date.now() + 6 * 3_600_000), endsAt: new Date(Date.now() + 8 * 3_600_000),
        bookingOpensAt: new Date(Date.now() - 3_600_000), bookingDeadline: new Date(Date.now() + 5 * 3_600_000),
        teamsCount: 8, playersPerTeam: 4, ticketPriceMajor: 1,
      }, { actor: actorB() })
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" })
    expect((await getSessionById(a.id, A.session)).title).toBe("A's Session")
  })

  it("cannot book into the session, even with a valid id", async () => {
    await expect(
      bookInline(b.id, { name: "B", email: "b@example.com", phone: "" }, { sessionId: A.session })
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" })
  })

  it("cannot join the waiting list of the session", async () => {
    await expect(joinWaitlist(b.id, A.session, { name: "B", email: "b@example.com" })).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" })
  })

  it("cannot cancel the booking", async () => {
    await expect(cancelPendingBooking(b.id, A.booking, { actor: actorB() })).rejects.toMatchObject({ code: "BOOKING_NOT_FOUND" })
  })

  it("cannot start or verify a payment for the booking", async () => {
    await expect(initializePayment(b.id, A.booking)).rejects.toMatchObject({ code: "BOOKING_NOT_FOUND" })
    await expect(verifyPayment(b.id, A.reference)).rejects.toMatchObject({ code: "PAYMENT_NOT_FOUND" })
  })

  it("cannot refund the payment", async () => {
    await expect(refundPayment(b.id, A.payment, "nope", { actor: actorB() })).rejects.toMatchObject({ code: "PAYMENT_NOT_FOUND" })
    const payment = await ctx.db.query.payments.findFirst({ where: eq(schema.payments.id, A.payment) })
    expect(payment?.status).toBe("PAID")
  })

  it("cannot cancel the ticket", async () => {
    await expect(cancelTicket(b.id, A.ticket, "nope", { actor: actorB() })).rejects.toMatchObject({ code: "TICKET_NOT_FOUND" })
    const ticket = await ctx.db.query.tickets.findFirst({ where: eq(schema.tickets.id, A.ticket) })
    expect(ticket?.status).toBe("CONFIRMED")
  })

  it("cannot admit the ticket at its gate, by QR or by number", async () => {
    // A ticket for another arena is indistinguishable from a forgery here —
    // which is right: it admits nobody, and saying more would confirm it exists.
    expect(await validateTicket(b.id, A.qr, { mode: "admit", actor: actorB() })).toEqual({ result: "INVALID" })
    expect(await validateTicket(b.id, A.ticketNumber, { mode: "admit", actor: actorB() })).toEqual({ result: "INVALID" })
    const ticket = await ctx.db.query.tickets.findFirst({ where: eq(schema.tickets.id, A.ticket) })
    expect(ticket?.status).toBe("CONFIRMED")
    expect(ticket?.usedAt).toBeNull()
  })

  it("logs the failed scan against the arena that scanned, not the ticket's", async () => {
    const scans = await ctx.db.query.ticketValidations.findMany({ where: eq(schema.ticketValidations.arenaId, b.id) })
    expect(scans.length).toBeGreaterThan(0)
    expect(scans.every((s) => s.ticketId === null)).toBe(true)
  })

  it("cannot update the customer", async () => {
    await expect(updateCustomer(b.id, A.customer, { name: "Hijacked" })).rejects.toMatchObject({ code: "NOT_FOUND" })
    const customer = await ctx.db.query.customers.findFirst({ where: eq(schema.customers.id, A.customer) })
    expect(customer?.name).toBe("A Player")
  })

  it("gets its own customer row when the same email books at both arenas", async () => {
    const mine = await upsertCustomerByEmail(b.id, { name: "A Player", email: "a.player@example.com" })
    expect(mine.id).not.toBe(A.customer)
    expect(mine.arenaId).toBe(b.id)
  })

  it("cannot update or delete the media item", async () => {
    await expect(updateMedia(b.id, A.media, { altText: "x" }, { actor: actorB() })).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(deleteMedia(b.id, A.media, { actor: actorB() })).rejects.toMatchObject({ code: "NOT_FOUND" })
    const media = await ctx.db.query.media.findFirst({ where: eq(schema.media.id, A.media) })
    expect(media?.deletedAt).toBeNull()
  })

  it("cannot edit or delete any CMS row", async () => {
    await expect(updateFaq(b.id, A.faq, { answer: "hijacked" }, { actor: actorB() })).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(deleteFaq(b.id, A.faq, { actor: actorB() })).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(updateService(b.id, A.service, { title: "hijacked" }, { actor: actorB() })).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(deleteService(b.id, A.service, { actor: actorB() })).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(updateAnnouncement(b.id, A.announcement, { title: "hijacked" }, { actor: actorB() })).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(deleteAnnouncement(b.id, A.announcement, { actor: actorB() })).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(updateBanner(b.id, A.banner, { title: "hijacked" }, { actor: actorB() })).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(deleteBanner(b.id, A.banner, { actor: actorB() })).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect((await listFaqs(a.id))[0].answer).toBe("A answer")
  })

  it("edits its own CMS pages without touching Arena A's", async () => {
    await saveDraft(b.id, "homepage", { ...(await getPage(b.id, "homepage")).draft, heroTitle: "B only" }, { actor: actorB() })
    const pageA = await getPage(a.id, "homepage")
    expect((pageA.draft as { heroTitle?: string }).heroTitle).not.toBe("B only")
  })

  it("cannot mark Arena A's notification as read", async () => {
    await markRead(b.id, A.notification)
    const notification = await ctx.db.query.notifications.findFirst({ where: eq(schema.notifications.id, A.notification) })
    expect(notification?.readAt).toBeNull()
  })
})

describe("the scope helper itself", () => {
  it("refuses an empty arena rather than running an unscoped query", async () => {
    await expect(listTickets("")).rejects.toMatchObject({ code: "INTERNAL_ERROR" })
    await expect(getSessionById("", A.session)).rejects.toMatchObject({ code: "INTERNAL_ERROR" })
  })
})
