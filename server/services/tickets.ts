import "server-only"
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm"
import QRCode from "qrcode"
import { db, schema, rowsOf, type Transaction } from "@/server/db"
import { forArena } from "@/server/db/scoped"
import { env } from "@/server/env"
import { AppError } from "@/server/http/errors"
import { hmac, randomToken, safeEqual, sha256 } from "@/server/auth/tokens"
import { assertTransition, isAdmissible } from "./ticket-state"
import { recordAudit, type AuditActor } from "./audit"

const QR_PREFIX = "AP1"

/** How long after a session ends a ticket still admits, for late arrivals and stragglers. */
const ADMISSION_GRACE_MS = 2 * 3_600_000

/**
 * A scanned code, reduced to something a human can recognise in the log
 * without it being usable. A ticket number is not a credential, so it is kept
 * whole; a QR payload keeps only its prefix and last four characters.
 */
function redactScan(scanned: string): string {
  const value = scanned.trim()
  if (/^AP-\d{4}-\d{6}$/i.test(value)) return value.toUpperCase()
  if (value.startsWith(`${QR_PREFIX}.`)) return `${QR_PREFIX}.…${value.slice(-4)}`
  return `…${value.slice(-4)}`
}

/**
 * Each arena signs its QR codes with its own derived key.
 *
 * The token itself stays opaque — it carries no personal data and no arena id
 * — but a code minted for one arena fails the signature check at another's
 * gate, before any database lookup. Domain separation, not secrecy: the arena
 * id is not sensitive, it simply must not be interchangeable.
 */
function qrKey(arenaId: string) {
  return hmac(env.QR_SECRET, `qr:${arenaId}`)
}

/** Ticket numbers look like AP-2026-000124: year + zero-padded global sequence. */
export async function nextTicketNumber(tx: Transaction) {
  const res = await tx.execute(sql`select nextval('ticket_number_seq') as n`)
  const n = Number(rowsOf<{ n: string | number }>(res)[0].n)
  return `AP-${new Date().getFullYear()}-${String(n).padStart(6, "0")}`
}

/** Opaque reference + HMAC. Contains no personal data; forgeries fail before a DB hit. */
export function buildQrPayload(arenaId: string, qrToken: string) {
  return `${QR_PREFIX}.${qrToken}.${hmac(qrKey(arenaId), qrToken).slice(0, 22)}`
}

/** Verifies the code against *this* arena's key. Null means "not ours". */
export function parseQrPayload(arenaId: string, value: string): { qrToken: string } | null {
  const parts = value.trim().split(".")
  if (parts.length !== 3 || parts[0] !== QR_PREFIX) return null
  const [, token, sig] = parts
  if (!token || !sig) return null
  const expected = hmac(qrKey(arenaId), token).slice(0, 22)
  return safeEqual(sig, expected) ? { qrToken: token } : null
}

export async function qrDataUrl(ticket: Pick<schema.Ticket, "arenaId" | "qrToken">) {
  return QRCode.toDataURL(buildQrPayload(ticket.arenaId, ticket.qrToken), {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
    color: { dark: "#0b0f14", light: "#ffffff" },
  })
}

export function newQrToken() {
  return randomToken(24)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
/**
 * Ticket numbers are globally unique, so this lookup is deliberately not
 * arena-scoped: it serves the public ticket link, where the reader proves
 * access with the signed key, their own customer session, or staff permission
 * *in the ticket's own arena*. The caller does that check — see
 * `app/api/tickets/[ticketNumber]`.
 */
export async function getTicketByNumber(ticketNumber: string) {
  const database = await db()
  const ticket = await database.query.tickets.findFirst({ where: eq(schema.tickets.ticketNumber, ticketNumber) })
  if (!ticket) throw new AppError("TICKET_NOT_FOUND", "Ticket not found")
  return hydrateTicket(ticket)
}

export async function getTicketById(arenaId: string, id: string) {
  const scope = forArena(arenaId)
  const database = await db()
  const ticket = await database.query.tickets.findFirst({ where: scope.owns(schema.tickets, eq(schema.tickets.id, id)) })
  if (!ticket) throw new AppError("TICKET_NOT_FOUND", "Ticket not found")
  return hydrateTicket(ticket)
}

export async function hydrateTicket(ticket: schema.Ticket) {
  const database = await db()
  const [session, customer, team, slot, arena] = await Promise.all([
    database.query.sessions.findFirst({ where: eq(schema.sessions.id, ticket.sessionId) }),
    database.query.customers.findFirst({ where: eq(schema.customers.id, ticket.customerId) }),
    ticket.teamId ? database.query.teams.findFirst({ where: eq(schema.teams.id, ticket.teamId) }) : null,
    ticket.slotId ? database.query.sessionSlots.findFirst({ where: eq(schema.sessionSlots.id, ticket.slotId) }) : null,
    database.query.arenas.findFirst({ where: eq(schema.arenas.id, ticket.arenaId) }),
  ])
  return { ticket, session: session!, customer: customer!, team: team ?? null, slot: slot ?? null, arena: arena ?? null }
}

export type TicketDetail = Awaited<ReturnType<typeof hydrateTicket>>

export async function listTickets(
  arenaId: string,
  opts: { status?: string; sessionId?: string; customerId?: string; q?: string; page?: number; pageSize?: number } = {}
) {
  const scope = forArena(arenaId)
  const database = await db()
  const page = opts.page ?? 1
  const pageSize = opts.pageSize ?? 20
  const where: SQL[] = [eq(schema.tickets.arenaId, scope.arenaId)]
  if (opts.status && opts.status !== "all") where.push(eq(schema.tickets.status, opts.status as schema.Ticket["status"]))
  if (opts.sessionId) where.push(eq(schema.tickets.sessionId, opts.sessionId))
  if (opts.customerId) where.push(eq(schema.tickets.customerId, opts.customerId))
  if (opts.q)
    where.push(or(ilike(schema.tickets.ticketNumber, `%${opts.q}%`), ilike(schema.customers.name, `%${opts.q}%`), ilike(schema.customers.email, `%${opts.q}%`), ilike(schema.tickets.playerName, `%${opts.q}%`))!)
  const condition = and(...where)
  const base = database
    .select({
      ticket: schema.tickets,
      customer: { id: schema.customers.id, name: schema.customers.name, email: schema.customers.email },
      session: { id: schema.sessions.id, title: schema.sessions.title, startsAt: schema.sessions.startsAt, endsAt: schema.sessions.endsAt, venue: schema.sessions.venue },
      slot: { teamNumber: schema.sessionSlots.teamNumber, slotNumber: schema.sessionSlots.slotNumber },
    })
    .from(schema.tickets)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.tickets.customerId))
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.tickets.sessionId))
    .leftJoin(schema.sessionSlots, eq(schema.sessionSlots.id, schema.tickets.slotId))
  const [{ count }] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.tickets)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.tickets.customerId))
    .where(condition)
  const items = await base.where(condition).orderBy(desc(schema.tickets.purchasedAt)).limit(pageSize).offset((page - 1) * pageSize)
  return { items, meta: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) } }
}

// ---------------------------------------------------------------------------
// Validation (entry scanning)
// ---------------------------------------------------------------------------
export type ValidationOutcome =
  | { result: "VALID"; ticket: TicketDetail }
  | { result: "ALREADY_USED"; ticket: TicketDetail }
  | { result: "NOT_VALID"; ticket: TicketDetail; reason: string }
  | { result: "WRONG_SESSION"; ticket: TicketDetail }
  | { result: "INVALID" }

/**
 * Looks up a scanned code (QR payload or ticket number). With mode "admit"
 * it atomically marks the ticket USED; a second scan reports ALREADY_USED.
 */
export async function validateTicket(
  arenaId: string,
  scanned: string,
  opts: { mode: "check" | "admit"; expectedSessionId?: string; actor: AuditActor & { id: string } }
): Promise<ValidationOutcome> {
  const scope = forArena(arenaId)
  const database = await db()
  const parsed = parseQrPayload(scope.arenaId, scanned)
  const value = scanned.trim().toUpperCase()
  // Scoped to the scanning arena: a valid ticket for a different arena is
  // indistinguishable from a forged one at this gate, which is correct — it
  // does not admit anybody here, and saying so would confirm it exists.
  const ticketRow = parsed
    ? await database.query.tickets.findFirst({ where: scope.owns(schema.tickets, eq(schema.tickets.qrToken, parsed.qrToken)) })
    : /^AP-\d{4}-\d{6}$/.test(value)
      ? await database.query.tickets.findFirst({ where: scope.owns(schema.tickets, eq(schema.tickets.ticketNumber, value)) })
      : null

  // The scanned value is a live credential, so only a recognisable fragment is
  // kept; the fingerprint lets repeated forgeries be correlated without
  // storing anything that could admit somebody.
  const log = (ticketId: string | null, sessionId: string | null, result: string, reason?: string) =>
    database.insert(schema.ticketValidations).values({
      arenaId: scope.arenaId,
      ticketId,
      sessionId,
      validatedBy: opts.actor.id,
      result,
      reason: reason ?? null,
      scannedValue: redactScan(scanned),
      scannedFingerprint: sha256(scanned.trim()),
    })

  if (!ticketRow) {
    // Unreadable, forged, or issued by another arena — indistinguishable here
    // on purpose: saying which would confirm that a code exists somewhere.
    await log(null, opts.expectedSessionId ?? null, "INVALID", "Not a ticket for this arena")
    return { result: "INVALID" }
  }

  const detail = await hydrateTicket(ticketRow)
  if (opts.expectedSessionId && ticketRow.sessionId !== opts.expectedSessionId) {
    await log(ticketRow.id, ticketRow.sessionId, "WRONG_SESSION", "Ticket is for a different session")
    return { result: "WRONG_SESSION", ticket: detail }
  }
  if (ticketRow.status === "USED") {
    await log(ticketRow.id, ticketRow.sessionId, "ALREADY_USED", `Already admitted${ticketRow.usedAt ? ` at ${ticketRow.usedAt.toISOString()}` : ""}`)
    return { result: "ALREADY_USED", ticket: detail }
  }
  if (!isAdmissible(ticketRow.status)) {
    const reason = `Ticket is ${ticketRow.status.toLowerCase()}`
    await log(ticketRow.id, ticketRow.sessionId, "NOT_VALID", reason)
    return { result: "NOT_VALID", ticket: detail, reason }
  }
  if (detail.session.status === "CANCELLED") {
    await log(ticketRow.id, ticketRow.sessionId, "NOT_VALID", "Session was cancelled")
    return { result: "NOT_VALID", ticket: detail, reason: "Session was cancelled" }
  }
  const now = new Date()
  // The ticket's own expiry, which outlives the session window and is what a
  // refunded-then-reissued ticket carries.
  if (ticketRow.expiresAt <= now) {
    await log(ticketRow.id, ticketRow.sessionId, "NOT_VALID", "Ticket has expired")
    return { result: "NOT_VALID", ticket: detail, reason: "Ticket has expired" }
  }
  if (now > new Date(detail.session.endsAt.getTime() + ADMISSION_GRACE_MS)) {
    await log(ticketRow.id, ticketRow.sessionId, "NOT_VALID", "Session has ended")
    return { result: "NOT_VALID", ticket: detail, reason: "Session has ended" }
  }

  if (opts.mode === "check") {
    await log(ticketRow.id, ticketRow.sessionId, "CHECK_VALID", "Valid, not admitted")
    return { result: "VALID", ticket: detail }
  }

  // Conditional update: only one admit can flip CONFIRMED → USED.
  const [used] = await database
    .update(schema.tickets)
    .set({ status: "USED", usedAt: new Date(), validatedBy: opts.actor.id, updatedAt: new Date() })
    .where(and(eq(schema.tickets.id, ticketRow.id), eq(schema.tickets.status, "CONFIRMED")))
    .returning()
  if (!used) {
    // Another scanner won the race. The loser reports ALREADY_USED, which is
    // exactly what a second scan of the same code should say.
    await log(ticketRow.id, ticketRow.sessionId, "ALREADY_USED", "Admitted by a simultaneous scan")
    return { result: "ALREADY_USED", ticket: await hydrateTicket((await database.query.tickets.findFirst({ where: eq(schema.tickets.id, ticketRow.id) }))!) }
  }
  await log(ticketRow.id, ticketRow.sessionId, "ADMITTED", "Admitted")
  await recordAudit(opts.actor, {
    action: "ticket.admit",
    entityType: "ticket",
    entityId: used.id,
    arenaId: used.arenaId,
    description: `Admitted ${used.ticketNumber} (${detail.customer.name})`,
  })
  return { result: "VALID", ticket: await hydrateTicket(used) }
}

/** Admin cancellation without refund (e.g. no-show policy); refunds go through payments. */
export async function cancelTicket(arenaId: string, id: string, reason: string, ctx: { actor: AuditActor }) {
  const scope = forArena(arenaId)
  const database = await db()
  const row = await database.transaction(async (tx) => {
    const [ticket] = await tx
      .select()
      .from(schema.tickets)
      .where(and(eq(schema.tickets.id, id), eq(schema.tickets.arenaId, scope.arenaId)))
      .for("update")
    if (!ticket) throw new AppError("TICKET_NOT_FOUND", "Ticket not found")
    if (ticket.status !== "CONFIRMED") throw new AppError("CONFLICT", `Ticket is already ${ticket.status.toLowerCase()}`)
    assertTransition(ticket.status, "CANCELLED", `cancel ${ticket.ticketNumber}`)
    return releaseConfirmedTicket(tx, ticket, "CANCELLED", reason)
  })
  await recordAudit(ctx.actor, { action: "ticket.cancel", entityType: "ticket", entityId: id, arenaId: row.arenaId, description: `Cancelled ${row.ticketNumber}`, metadata: { reason } })
  return row
}

/** Shared by cancel and refund: frees the slot and decrements the confirmed counter. */
export async function releaseConfirmedTicket(tx: Transaction, ticket: schema.Ticket, status: "CANCELLED" | "REFUNDED", reason: string) {
  const now = new Date()
  await tx.select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.id, ticket.sessionId)).for("update")
  const [updated] = await tx
    .update(schema.tickets)
    .set({ status, cancelledAt: status === "CANCELLED" ? now : ticket.cancelledAt, refundedAt: status === "REFUNDED" ? now : null, paymentStatus: status === "REFUNDED" ? "REFUNDED" : ticket.paymentStatus, updatedAt: now })
    .where(eq(schema.tickets.id, ticket.id))
    .returning()
  await tx
    .update(schema.bookings)
    .set({ status: "CANCELLED", cancelledAt: now, cancellationReason: reason, updatedAt: now })
    .where(eq(schema.bookings.id, ticket.bookingId))
  if (ticket.slotId) {
    await tx.update(schema.sessionSlots).set({ status: "FREE", bookingId: null, updatedAt: now }).where(eq(schema.sessionSlots.id, ticket.slotId))
  }
  await tx
    .update(schema.sessions)
    .set({
      bookedCount: sql`greatest(0, ${schema.sessions.bookedCount} - 1)`,
      status: sql`case when ${schema.sessions.status} = 'FULL' then 'OPEN_FOR_BOOKING'::session_status else ${schema.sessions.status} end`,
      updatedAt: now,
    })
    .where(eq(schema.sessions.id, ticket.sessionId))
  return updated
}
