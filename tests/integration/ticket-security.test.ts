import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { randomUUID } from "node:crypto"
import { desc, eq } from "drizzle-orm"
import * as schema from "@/server/db/schema"
import { createTestDb } from "../helpers/db"
import { getArena, getAdminUser, makeArena, makeOpenSession, customer, testActor , bookAs} from "../helpers/fixtures"
import { createBooking } from "@/server/services/bookings"
import { initializePayment, verifyPayment } from "@/server/services/payments"
import { setMockOutcome } from "@/server/payments/mock"
import { buildQrPayload, parseQrPayload, validateTicket, cancelTicket } from "@/server/services/tickets"
import { assertTransition, canTransition, isAdmissible } from "@/server/services/ticket-state"

let ctx: Awaited<ReturnType<typeof createTestDb>>
let arena: schema.Arena
let other: schema.Arena
let actor: typeof testActor

beforeAll(async () => {
  ctx = await createTestDb()
  arena = await getArena(ctx.db)
  other = await makeArena(ctx.db, "arena-b")
  const admin = await getAdminUser(ctx.db)
  actor = { ...testActor, id: admin.id }
})
afterAll(async () => {
  await ctx.client.close()
})

let seq = 0
/** A paid ticket, through the real booking and payment path. */
async function issueTicket(sessionId?: string) {
  const session = sessionId ? { id: sessionId } : await makeOpenSession(ctx.db)
  const { booking } = await bookAs(arena.id, 900 + seq++, { sessionId: session.id })
  const { payment } = await initializePayment(arena.id, booking.id)
  await setMockOutcome(payment.reference, "success")
  const outcome = await verifyPayment(arena.id, payment.reference)
  if (outcome.status !== "PAID") throw new Error(`expected PAID, got ${outcome.status}`)
  return outcome.ticket
}

const lastScan = async () =>
  (await ctx.db.select().from(schema.ticketValidations).orderBy(desc(schema.ticketValidations.createdAt)).limit(1))[0]

describe("the QR code is signed per arena", () => {
  it("carries no personal data — only an opaque reference and a signature", async () => {
    const ticket = await issueTicket()
    const payload = buildQrPayload(arena.id, ticket.qrToken)
    const [prefix, token, signature] = payload.split(".")
    expect(prefix).toBe("AP1")
    expect(token).toBe(ticket.qrToken)
    expect(signature).toHaveLength(22)
    // Nothing identifying: not the number, the customer, the session or the arena.
    expect(payload).not.toContain(ticket.ticketNumber)
    expect(payload).not.toContain(ticket.customerId)
    expect(payload).not.toContain(ticket.sessionId)
    expect(payload).not.toContain(arena.id)
  })

  it("fails the signature check at another arena's gate, before any lookup", async () => {
    const ticket = await issueTicket()
    const payload = buildQrPayload(arena.id, ticket.qrToken)
    expect(parseQrPayload(arena.id, payload)).toEqual({ qrToken: ticket.qrToken })
    expect(parseQrPayload(other.id, payload)).toBeNull()
  })

  it("rejects a tampered signature or token", async () => {
    const ticket = await issueTicket()
    const payload = buildQrPayload(arena.id, ticket.qrToken)
    const [p, token, sig] = payload.split(".")
    expect(parseQrPayload(arena.id, `${p}.${token}.${sig.slice(0, -1)}X`)).toBeNull()
    expect(parseQrPayload(arena.id, `${p}.${token}X.${sig}`)).toBeNull()
    expect(parseQrPayload(arena.id, `AP9.${token}.${sig}`)).toBeNull()
  })
})

describe("admitting a ticket", () => {
  it("admits once and reports every later scan as already used", async () => {
    const ticket = await issueTicket()
    const code = buildQrPayload(arena.id, ticket.qrToken)

    const first = await validateTicket(arena.id, code, { mode: "admit", actor })
    expect(first.result).toBe("VALID")

    const second = await validateTicket(arena.id, code, { mode: "admit", actor })
    expect(second.result).toBe("ALREADY_USED")

    const row = (await ctx.db.query.tickets.findFirst({ where: eq(schema.tickets.id, ticket.id) }))!
    expect(row.status).toBe("USED")
    expect(row.usedAt).not.toBeNull()
  })

  it("admits exactly once when two gates scan the same code at the same moment", async () => {
    const ticket = await issueTicket()
    const code = buildQrPayload(arena.id, ticket.qrToken)

    const results = await Promise.all([
      validateTicket(arena.id, code, { mode: "admit", actor }),
      validateTicket(arena.id, code, { mode: "admit", actor }),
      validateTicket(arena.id, code, { mode: "admit", actor }),
    ])
    expect(results.filter((r) => r.result === "VALID")).toHaveLength(1)
    expect(results.filter((r) => r.result === "ALREADY_USED")).toHaveLength(2)

    const scans = await ctx.db.select().from(schema.ticketValidations).where(eq(schema.ticketValidations.ticketId, ticket.id))
    expect(scans.filter((s) => s.result === "ADMITTED")).toHaveLength(1)
  })

  it("checks without admitting in check mode", async () => {
    const ticket = await issueTicket()
    const code = buildQrPayload(arena.id, ticket.qrToken)
    expect((await validateTicket(arena.id, code, { mode: "check", actor })).result).toBe("VALID")
    const row = (await ctx.db.query.tickets.findFirst({ where: eq(schema.tickets.id, ticket.id) }))!
    expect(row.status).toBe("CONFIRMED")
    expect((await lastScan()).result).toBe("CHECK_VALID")
  })

  it("refuses a cancelled ticket and says why", async () => {
    const ticket = await issueTicket()
    await cancelTicket(arena.id, ticket.id, "No-show policy", { actor })
    const outcome = await validateTicket(arena.id, buildQrPayload(arena.id, ticket.qrToken), { mode: "admit", actor })
    expect(outcome.result).toBe("NOT_VALID")
    expect((await lastScan()).reason).toMatch(/cancelled/i)
  })

  it("refuses a ticket whose own expiry has passed", async () => {
    const ticket = await issueTicket()
    await ctx.db
      .update(schema.tickets)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.tickets.id, ticket.id))
    const outcome = await validateTicket(arena.id, buildQrPayload(arena.id, ticket.qrToken), { mode: "admit", actor })
    expect(outcome.result).toBe("NOT_VALID")
    expect((await lastScan()).reason).toMatch(/expired/i)
    const row = (await ctx.db.query.tickets.findFirst({ where: eq(schema.tickets.id, ticket.id) }))!
    expect(row.status).toBe("CONFIRMED")
  })
})

describe("the scan log", () => {
  it("never stores a usable code", async () => {
    const ticket = await issueTicket()
    const code = buildQrPayload(arena.id, ticket.qrToken)
    await validateTicket(arena.id, code, { mode: "admit", actor })

    const scan = await lastScan()
    expect(scan.scannedValue).toBe(`AP1.…${code.slice(-4)}`)
    // The stored value must not be enough to admit anyone.
    expect(scan.scannedValue).not.toContain(ticket.qrToken)
    expect(parseQrPayload(arena.id, scan.scannedValue!)).toBeNull()
    // …but repeated presentations of the same code are still correlatable.
    expect(scan.scannedFingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it("keeps a plain ticket number whole, because it is not a credential", async () => {
    const ticket = await issueTicket()
    await validateTicket(arena.id, ticket.ticketNumber, { mode: "check", actor })
    expect((await lastScan()).scannedValue).toBe(ticket.ticketNumber)
  })

  it("records a failed scan against the arena that scanned it, with no ticket", async () => {
    await validateTicket(arena.id, "AP1.forged-token.forgedsignature123", { mode: "admit", actor })
    const scan = await lastScan()
    expect(scan.result).toBe("INVALID")
    expect(scan.ticketId).toBeNull()
    expect(scan.arenaId).toBe(arena.id)
    expect(scan.reason).toMatch(/not a ticket for this arena/i)
  })
})

describe("the ticket state machine", () => {
  it("allows the moves a ticket actually makes", () => {
    expect(canTransition("CONFIRMED", "USED")).toBe(true)
    expect(canTransition("CONFIRMED", "CANCELLED")).toBe(true)
    expect(canTransition("CONFIRMED", "REFUNDED")).toBe(true)
    // Refunding someone who already attended is a goodwill decision, not an error.
    expect(canTransition("USED", "REFUNDED")).toBe(true)
  })

  it("never un-admits someone who is already inside", () => {
    expect(canTransition("USED", "CONFIRMED")).toBe(false)
    expect(canTransition("USED", "CANCELLED")).toBe(false)
    expect(() => assertTransition("USED", "CONFIRMED", "gate")).toThrowError(/cannot become confirmed/)
  })

  it("treats refunded and expired as final, and only a confirmed ticket as admissible", () => {
    expect(canTransition("REFUNDED", "USED")).toBe(false)
    expect(canTransition("EXPIRED", "CONFIRMED")).toBe(false)
    expect(isAdmissible("CONFIRMED")).toBe(true)
    for (const status of ["PENDING", "USED", "CANCELLED", "REFUNDED", "EXPIRED"] as const) {
      expect(isAdmissible(status), status).toBe(false)
    }
  })
})
