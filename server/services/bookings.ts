import "server-only"
import { logger, serializeError } from "@/server/observability/logger"
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm"
import { db, schema, rowsOf, type Transaction } from "@/server/db"
import { forArena } from "@/server/db/scoped"
import { AppError, isUniqueViolation } from "@/server/http/errors"
import { checkBookable } from "@/lib/domain/session-status"
import type { CreateBookingInput } from "@/lib/validation/bookings"
import { getSettings } from "./settings"
import { recordAudit, type AuditActor } from "./audit"
import { upsertCustomerByEmail } from "./customers"

const BOOKABILITY_ERRORS = {
  NOT_PUBLISHED: ["SESSION_NOT_BOOKABLE", "This session is not open for booking"],
  CANCELLED: ["SESSION_NOT_BOOKABLE", "This session has been cancelled"],
  BOOKING_NOT_OPEN: ["BOOKING_NOT_OPEN", "Booking has not opened yet for this session"],
  BOOKING_CLOSED: ["BOOKING_CLOSED", "Booking has closed for this session"],
  SESSION_FULL: ["SESSION_FULL", "This session is fully booked"],
  SESSION_STARTED: ["BOOKING_CLOSED", "This session has already started"],
} as const

/**
 * Releases expired pending reservations for one session. Must run while the
 * caller holds the session row lock so counters stay consistent.
 */
async function releaseExpiredHolds(tx: Transaction, sessionId: string, now: Date) {
  const expired = await tx
    .update(schema.bookings)
    .set({ status: "EXPIRED", updatedAt: now })
    .where(and(eq(schema.bookings.sessionId, sessionId), eq(schema.bookings.status, "PENDING"), lt(schema.bookings.expiresAt, now)))
    .returning({ id: schema.bookings.id })
  if (expired.length === 0) return 0
  const ids = expired.map((b) => b.id)
  await tx
    .update(schema.sessionSlots)
    .set({ status: "FREE", bookingId: null, updatedAt: now })
    .where(inArray(schema.sessionSlots.bookingId, ids))
  await tx
    .update(schema.sessions)
    .set({ heldCount: sql`greatest(0, ${schema.sessions.heldCount} - ${expired.length})`, updatedAt: now })
    .where(eq(schema.sessions.id, sessionId))
  return expired.length
}

/**
 * Claims one free slot for a booking. Balanced allocation: fills slot 1 of
 * every team before slot 2, so partially-sold sessions still have even
 * teams. `FOR UPDATE SKIP LOCKED` lets concurrent transactions on a real
 * Postgres each grab a different row instead of queueing on the same one.
 */
async function claimSlot(tx: Transaction, sessionId: string, bookingId: string, preferredTeam: number | undefined, now: Date) {
  const preference = preferredTeam
    ? sql`case when ${schema.sessionSlots.teamNumber} = ${preferredTeam} then 0 else 1 end,`
    : sql``
  const result = await tx.execute(sql`
    update ${schema.sessionSlots}
       set status = 'HELD', booking_id = ${bookingId}, updated_at = ${now}
     where id = (
       select id from ${schema.sessionSlots}
        where session_id = ${sessionId} and status = 'FREE'
        order by ${preference} slot_number asc, team_number asc
        limit 1
        for update skip locked
     )
     returning id, team_id, team_number, slot_number
  `)
  const row = rowsOf<{ id: string; team_id: string; team_number: number; slot_number: number }>(result)[0]
  return row ?? null
}

export interface CreatedBooking {
  booking: schema.Booking
  slot: { teamNumber: number; slotNumber: number }
  session: schema.Session
  customer: schema.Customer
  reused: boolean
}

/**
 * Reserve a player slot. All integrity checks happen inside one transaction
 * holding the session row lock; the database CHECK and UNIQUE constraints
 * are the final guard even if this code were bypassed.
 */
export async function createBooking(
  arenaId: string,
  input: CreateBookingInput,
  ctx: { actor: AuditActor; createdByUserId?: string | null }
): Promise<CreatedBooking> {
  const scope = forArena(arenaId)
  const database = await db()

  // Idempotent replay: same key → same booking, no new hold. Scoped to the
  // arena, so one arena replaying another's key cannot read their booking.
  const existing = await database.query.bookings.findFirst({
    where: scope.owns(schema.bookings, eq(schema.bookings.idempotencyKey, input.idempotencyKey)),
  })
  if (existing) return hydrate(existing, true)

  const customer = await upsertCustomerByEmail(scope.arenaId, input.customer)
  const now = new Date()

  try {
    const created = await database.transaction(async (tx) => {
      // The session is looked up inside this arena. A session id from another
      // arena is simply not found — it is never bookable from here.
      const [session] = await tx
        .select()
        .from(schema.sessions)
        .where(and(eq(schema.sessions.id, input.sessionId), eq(schema.sessions.arenaId, scope.arenaId)))
        .for("update")
      if (!session || session.deletedAt) throw new AppError("SESSION_NOT_FOUND", "Session not found")

      const released = await releaseExpiredHolds(tx, session.id, now)
      const live = released ? { ...session, heldCount: Math.max(0, session.heldCount - released) } : session

      const bookable = checkBookable(live, now)
      if (!bookable.bookable && bookable.reason) {
        const [code, message] = BOOKABILITY_ERRORS[bookable.reason]
        throw new AppError(code, message)
      }

      // Read through the transaction: never touch the outer connection while holding the lock.
      const settings = await getSettings(session.arenaId, tx)
      const [booking] = await tx
        .insert(schema.bookings)
        .values({
          arenaId: session.arenaId,
          sessionId: session.id,
          customerId: customer.id,
          playerName: input.playerName?.trim() || customer.name,
          amount: session.ticketPrice,
          currency: session.currency,
          idempotencyKey: input.idempotencyKey,
          expiresAt: new Date(now.getTime() + settings.bookingHoldMinutes * 60_000),
          createdByUserId: ctx.createdByUserId ?? null,
        })
        .returning()

      const slot = await claimSlot(tx, session.id, booking.id, input.preferredTeamNumber, now)
      if (!slot) throw new AppError("SESSION_FULL", "This session is fully booked")

      const [withSlot] = await tx
        .update(schema.bookings)
        .set({ slotId: slot.id, teamId: slot.team_id })
        .where(eq(schema.bookings.id, booking.id))
        .returning()

      // Bounded by CHECK (booked + held <= capacity): a concurrent oversell fails here.
      const [updatedSession] = await tx
        .update(schema.sessions)
        .set({ heldCount: sql`${schema.sessions.heldCount} + 1`, updatedAt: now })
        .where(eq(schema.sessions.id, session.id))
        .returning()

      return { booking: withSlot, slot: { teamNumber: slot.team_number, slotNumber: slot.slot_number }, session: updatedSession }
    })

    await recordAudit(ctx.actor, {
      action: "booking.create",
      entityType: "booking",
      entityId: created.booking.id,
      arenaId: created.session.arenaId,
      description: `${customer.name} reserved Team ${created.slot.teamNumber} slot ${created.slot.slotNumber} for "${created.session.title}"`,
    })
    return { ...created, customer, reused: false }
  } catch (err) {
    if (isUniqueViolation(err, "bookings_idempotency_idx")) {
      const replay = await database.query.bookings.findFirst({
        where: scope.owns(schema.bookings, eq(schema.bookings.idempotencyKey, input.idempotencyKey)),
      })
      if (replay) return hydrate(replay, true)
      // The key is taken by another arena. Until the unique index is composite
      // this is possible, and returning their booking would be a cross-tenant
      // leak — so it is a conflict, not a replay.
      throw new AppError("DUPLICATE_BOOKING", "This booking reference is already in use")
    }
    if (err instanceof AppError) throw err
    // Constraint violations from a race collapse into the business error.
    if (String((err as Error)?.message).includes("sessions_not_oversold")) throw new AppError("SESSION_FULL", "This session is fully booked")
    throw err
  }

  async function hydrate(booking: schema.Booking, reused: boolean): Promise<CreatedBooking> {
    const session = (await database.query.sessions.findFirst({ where: scope.owns(schema.sessions, eq(schema.sessions.id, booking.sessionId)) }))!
    const customerRow = (await database.query.customers.findFirst({ where: eq(schema.customers.id, booking.customerId) }))!
    const slot = booking.slotId ? await database.query.sessionSlots.findFirst({ where: eq(schema.sessionSlots.id, booking.slotId) }) : null
    return { booking, session, customer: customerRow, reused, slot: { teamNumber: slot?.teamNumber ?? 0, slotNumber: slot?.slotNumber ?? 0 } }
  }
}

export async function getBookingById(arenaId: string, id: string) {
  const scope = forArena(arenaId)
  const database = await db()
  const booking = await database.query.bookings.findFirst({ where: scope.owns(schema.bookings, eq(schema.bookings.id, id)) })
  if (!booking) throw new AppError("BOOKING_NOT_FOUND", "Booking not found")
  const [session, customer, slot, payment, ticket] = await Promise.all([
    database.query.sessions.findFirst({ where: eq(schema.sessions.id, booking.sessionId) }),
    database.query.customers.findFirst({ where: eq(schema.customers.id, booking.customerId) }),
    booking.slotId ? database.query.sessionSlots.findFirst({ where: eq(schema.sessionSlots.id, booking.slotId) }) : null,
    database.query.payments.findFirst({ where: eq(schema.payments.bookingId, id), orderBy: (p, { desc }) => [desc(p.createdAt)] }),
    database.query.tickets.findFirst({ where: eq(schema.tickets.bookingId, id) }),
  ])
  return { booking, session: session!, customer: customer!, slot, payment: payment ?? null, ticket: ticket ?? null }
}

/** Customer-initiated cancel of an unpaid reservation. */
export async function cancelPendingBooking(arenaId: string, id: string, ctx: { actor: AuditActor }) {
  const scope = forArena(arenaId)
  const database = await db()
  const result = await database.transaction(async (tx) => {
    const [booking] = await tx
      .select()
      .from(schema.bookings)
      .where(and(eq(schema.bookings.id, id), eq(schema.bookings.arenaId, scope.arenaId)))
      .for("update")
    if (!booking) throw new AppError("BOOKING_NOT_FOUND", "Booking not found")
    if (booking.status !== "PENDING") throw new AppError("CONFLICT", "Only pending reservations can be released")
    const now = new Date()
    await tx.select().from(schema.sessions).where(eq(schema.sessions.id, booking.sessionId)).for("update")
    await tx.update(schema.bookings).set({ status: "CANCELLED", cancelledAt: now, updatedAt: now }).where(eq(schema.bookings.id, id))
    await tx.update(schema.sessionSlots).set({ status: "FREE", bookingId: null, updatedAt: now }).where(eq(schema.sessionSlots.bookingId, id))
    await tx
      .update(schema.sessions)
      .set({ heldCount: sql`greatest(0, ${schema.sessions.heldCount} - 1)`, updatedAt: now })
      .where(eq(schema.sessions.id, booking.sessionId))
    return booking
  })
  await recordAudit(ctx.actor, { action: "booking.cancel", entityType: "booking", entityId: id, arenaId: result.arenaId, description: "Released a pending reservation" })
  return result
}

/**
 * Releases one session's expired holds right away (no-op when there are none).
 * Called on single-session reads so availability, the displayed status and the
 * checkout gate never lag behind a hold that has already timed out.
 */
export async function releaseExpiredHoldsForSession(sessionId: string) {
  const database = await db()
  const now = new Date()
  return database.transaction(async (tx) => {
    await tx.select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.id, sessionId)).for("update")
    return releaseExpiredHolds(tx, sessionId, now)
  })
}

const holdSweep = globalThis as unknown as { __gameSlotsHoldSweep?: { at: number; running?: Promise<void> } }

/**
 * Throttled sweep of every expired hold, for list reads. The housekeeping cron
 * remains the primary mechanism; this keeps listings correct when the cron is
 * late or not configured (local dev). Runs at most once per `minIntervalMs` per
 * process and never throws into the caller.
 */
export function sweepExpiredHolds(minIntervalMs = 30_000): Promise<void> {
  const state = (holdSweep.__gameSlotsHoldSweep ??= { at: 0 })
  if (state.running) return state.running
  if (Date.now() - state.at < minIntervalMs) return Promise.resolve()
  state.at = Date.now()
  state.running = expireStaleBookings()
    .then(() => undefined)
    .catch((err) => logger.warn("bookings.hold_sweep_failed", { error: serializeError(err) }))
    .finally(() => {
      state.running = undefined
    })
  return state.running
}

/**
 * Platform-level housekeeping: releases expired holds in every arena.
 *
 * Deliberately not arena-scoped — it is the cron's job to sweep the whole
 * database — but it only ever moves a hold that has already expired back to
 * FREE, which is the same work each arena would do for itself. It reads no
 * tenant data and returns none.
 */
export async function expireStaleBookings() {
  const database = await db()
  const now = new Date()
  const stale = await database
    .selectDistinct({ sessionId: schema.bookings.sessionId })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.status, "PENDING"), lt(schema.bookings.expiresAt, now)))
  let released = 0
  for (const { sessionId } of stale) {
    released += await database.transaction(async (tx) => {
      await tx.select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.id, sessionId)).for("update")
      return releaseExpiredHolds(tx, sessionId, now)
    })
  }
  return { released }
}

export async function listBookingsForSession(arenaId: string, sessionId: string) {
  const scope = forArena(arenaId)
  const database = await db()
  return database
    .select({
      booking: schema.bookings,
      customer: { id: schema.customers.id, name: schema.customers.name, email: schema.customers.email },
      slot: { teamNumber: schema.sessionSlots.teamNumber, slotNumber: schema.sessionSlots.slotNumber },
    })
    .from(schema.bookings)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.bookings.customerId))
    .leftJoin(schema.sessionSlots, eq(schema.sessionSlots.id, schema.bookings.slotId))
    .where(scope.owns(schema.bookings, eq(schema.bookings.sessionId, sessionId)))
    .orderBy(asc(schema.bookings.createdAt))
}
