import "server-only"
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm"
import { forArena } from "@/server/db/scoped"
import { db, schema, type DbExecutor } from "@/server/db"
import { AppError, notFound } from "@/server/http/errors"
import { computeCapacity } from "@/lib/domain/constants"
import { deriveSessionStatus } from "@/lib/domain/session-status"
import type { SessionInput } from "@/lib/validation/sessions"
import { recordAudit, type AuditActor } from "./audit"
import { releaseExpiredHoldsForSession, sweepExpiredHolds } from "./bookings"
import { getSettings } from "./settings"

export type SessionRecord = schema.Session
export type SessionWithStatus = SessionRecord & { effectiveStatus: ReturnType<typeof deriveSessionStatus> }

export function withStatus<T extends schema.Session>(s: T, now = new Date()): T & { effectiveStatus: ReturnType<typeof deriveSessionStatus> } {
  return { ...s, effectiveStatus: deriveSessionStatus(s, now) }
}

const notDeleted = isNull(schema.sessions.deletedAt)

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export async function getSessionById(arenaId: string, id: string, opts: { includeDraft?: boolean } = {}) {
  const scope = forArena(arenaId)
  const database = await db()
  let s = await database.query.sessions.findFirst({ where: scope.owns(schema.sessions, eq(schema.sessions.id, id), notDeleted) })
  if (!s) throw new AppError("SESSION_NOT_FOUND", "Session not found")
  if (!opts.includeDraft && s.status === "DRAFT") throw new AppError("SESSION_NOT_FOUND", "Session not found")
  // Holds count toward "full", so free any that have timed out before deriving status:
  // otherwise a dead hold would show Sold Out and bounce customers away from checkout.
  if (s.heldCount > 0) {
    const freed = await releaseExpiredHoldsForSession(s.id)
    if (freed) s = { ...s, heldCount: Math.max(0, s.heldCount - freed) }
  }
  return withStatus(s)
}

export async function getSessionWithTeams(arenaId: string, id: string, opts: { includeDraft?: boolean } = {}) {
  const scope = forArena(arenaId)
  const database = await db()
  const session = await getSessionById(scope.arenaId, id, opts)
  const teamRows = await database.query.teams.findMany({
    where: eq(schema.teams.sessionId, id),
    orderBy: [asc(schema.teams.teamNumber)],
  })
  const slotRows = await database.query.sessionSlots.findMany({
    where: eq(schema.sessionSlots.sessionId, id),
    orderBy: [asc(schema.sessionSlots.teamNumber), asc(schema.sessionSlots.slotNumber)],
  })
  const teams = teamRows.map((t) => ({
    ...t,
    slots: slotRows.filter((s) => s.teamId === t.id),
  }))
  return { session, teams }
}

export interface ListSessionsOptions {
  /** Required. A listing without an arena would span tenants. */
  arenaId: string
  /** Public listings exclude drafts, cancelled and past sessions. */
  publicOnly?: boolean
  status?: string
  from?: Date
  to?: Date
  q?: string
  page?: number
  pageSize?: number
  order?: "asc" | "desc"
}

export async function listSessions(opts: ListSessionsOptions) {
  // Throttled: keeps list availability honest even when the housekeeping cron is late or absent.
  await sweepExpiredHolds()
  const database = await db()
  const page = opts.page ?? 1
  const pageSize = opts.pageSize ?? 20
  const where: SQL[] = [notDeleted]
  if (opts.arenaId) where.push(eq(schema.sessions.arenaId, opts.arenaId))
  if (opts.publicOnly) {
    where.push(inArray(schema.sessions.status, ["PUBLISHED", "OPEN_FOR_BOOKING", "FULL", "IN_PROGRESS"]))
    where.push(gte(schema.sessions.endsAt, new Date()))
  }
  if (opts.status && opts.status !== "all") {
    if (opts.status === "upcoming") where.push(gte(schema.sessions.startsAt, new Date()), inArray(schema.sessions.status, ["PUBLISHED", "OPEN_FOR_BOOKING", "FULL"]))
    else if (opts.status === "completed") where.push(or(eq(schema.sessions.status, "COMPLETED"), lte(schema.sessions.endsAt, new Date()))!)
    else where.push(eq(schema.sessions.status, opts.status as schema.Session["status"]))
  }
  if (opts.from) where.push(gte(schema.sessions.startsAt, opts.from))
  if (opts.to) where.push(lte(schema.sessions.startsAt, opts.to))
  if (opts.q) where.push(or(ilike(schema.sessions.title, `%${opts.q}%`), ilike(schema.sessions.venue, `%${opts.q}%`))!)

  const condition = and(...where)
  const [{ count }] = await database.select({ count: sql<number>`count(*)::int` }).from(schema.sessions).where(condition)
  const rows = await database
    .select()
    .from(schema.sessions)
    .where(condition)
    .orderBy(opts.order === "desc" ? desc(schema.sessions.startsAt) : asc(schema.sessions.startsAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
  const now = new Date()
  return {
    items: rows.map((r) => withStatus(r, now)),
    meta: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) },
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
function toRow(input: SessionInput, arenaId: string, currency: string) {
  return {
    arenaId,
    title: input.title,
    description: input.description || null,
    venue: input.venue,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    bookingOpensAt: input.bookingOpensAt,
    bookingDeadline: input.bookingDeadline,
    teamsCount: input.teamsCount,
    playersPerTeam: input.playersPerTeam,
    totalCapacity: computeCapacity(input.teamsCount, input.playersPerTeam),
    ticketPrice: Math.round(input.ticketPriceMajor * 100),
    currency,
    coverMediaId: input.coverMediaId ?? null,
  }
}

/**
 * Generates the team rows and the full grid of player slots for a session.
 *
 * `arenaId` is carried down from the session rather than left to be derived:
 * the grid is the hottest thing the booking path reads, and a slot that knows
 * its own arena can be filtered without a join.
 */
export async function generateTeamsAndSlots(
  ex: DbExecutor,
  arenaId: string,
  sessionId: string,
  teamsCount: number,
  playersPerTeam: number
) {
  const teamRows = await ex
    .insert(schema.teams)
    .values(Array.from({ length: teamsCount }, (_, i) => ({ arenaId, sessionId, teamNumber: i + 1, name: `Team ${i + 1}` })))
    .returning()
  const slotValues = teamRows.flatMap((t) =>
    Array.from({ length: playersPerTeam }, (_, j) => ({ arenaId, sessionId, teamId: t.id, teamNumber: t.teamNumber, slotNumber: j + 1 }))
  )
  await ex.insert(schema.sessionSlots).values(slotValues)
}

export async function createSession(input: SessionInput, ctx: { arenaId: string; actor: AuditActor }) {
  const database = await db()
  const settings = await getSettings(ctx.arenaId)
  const session = await database.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.sessions)
      .values({
        ...toRow(input, ctx.arenaId, settings.currency),
        status: input.publish ? "PUBLISHED" : "DRAFT",
        publishedAt: input.publish ? new Date() : null,
        createdBy: ctx.actor.type === "user" ? ctx.actor.id ?? null : null,
      })
      .returning()
    await generateTeamsAndSlots(tx, ctx.arenaId, row.id, row.teamsCount, row.playersPerTeam)
    return row
  })
  await recordAudit(ctx.actor, {
    action: "session.create",
    entityType: "session",
    entityId: session.id,
    arenaId: ctx.arenaId,
    description: `Created session "${session.title}"`,
    metadata: { capacity: session.totalCapacity, price: session.ticketPrice, published: !!input.publish },
  })
  return withStatus(session)
}

export async function updateSession(arenaId: string, id: string, input: SessionInput, ctx: { actor: AuditActor }) {
  const scope = forArena(arenaId)
  const database = await db()
  const updated = await database.transaction(async (tx) => {
    const [existing] = await tx.select().from(schema.sessions).where(scope.owns(schema.sessions, eq(schema.sessions.id, id), notDeleted)).for("update")
    if (!existing) throw new AppError("SESSION_NOT_FOUND", "Session not found")
    if (existing.status === "CANCELLED" || existing.status === "COMPLETED")
      throw new AppError("CONFLICT", "Completed or cancelled sessions cannot be edited")

    const capacityChanged = existing.teamsCount !== input.teamsCount || existing.playersPerTeam !== input.playersPerTeam
    if (capacityChanged && existing.bookedCount + existing.heldCount > 0) {
      throw new AppError("CONFLICT", "Team structure cannot change once players have booked")
    }
    const [row] = await tx
      .update(schema.sessions)
      .set({ ...toRow(input, existing.arenaId, existing.currency), updatedAt: new Date() })
      .where(eq(schema.sessions.id, id))
      .returning()
    if (capacityChanged) {
      await tx.delete(schema.sessionSlots).where(eq(schema.sessionSlots.sessionId, id))
      await tx.delete(schema.teams).where(eq(schema.teams.sessionId, id))
      await generateTeamsAndSlots(tx, scope.arenaId, id, row.teamsCount, row.playersPerTeam)
    }
    return row
  })
  await recordAudit(ctx.actor, {
    action: "session.update",
    entityType: "session",
    entityId: id,
    arenaId: updated.arenaId,
    description: `Updated session "${updated.title}"`,
  })
  return withStatus(updated)
}

export async function publishSession(arenaId: string, id: string, ctx: { actor: AuditActor }) {
  const scope = forArena(arenaId)
  const database = await db()
  const [row] = await database
    .update(schema.sessions)
    .set({ status: "PUBLISHED", publishedAt: new Date(), updatedAt: new Date() })
    .where(scope.owns(schema.sessions, eq(schema.sessions.id, id), eq(schema.sessions.status, "DRAFT"), notDeleted))
    .returning()
  if (!row) throw new AppError("CONFLICT", "Only draft sessions can be published")
  await recordAudit(ctx.actor, { action: "session.publish", entityType: "session", entityId: id, arenaId: row.arenaId, description: `Published session "${row.title}"` })
  return withStatus(row)
}

export async function unpublishSession(arenaId: string, id: string, ctx: { actor: AuditActor }) {
  const scope = forArena(arenaId)
  const database = await db()
  const [row] = await database
    .update(schema.sessions)
    .set({ status: "DRAFT", updatedAt: new Date() })
    .where(scope.owns(schema.sessions, eq(schema.sessions.id, id), eq(schema.sessions.status, "PUBLISHED"), eq(schema.sessions.bookedCount, 0), notDeleted))
    .returning()
  if (!row) throw new AppError("CONFLICT", "Only published sessions with no bookings can be unpublished")
  await recordAudit(ctx.actor, { action: "session.unpublish", entityType: "session", entityId: id, arenaId: row.arenaId, description: `Unpublished session "${row.title}"` })
  return withStatus(row)
}

export async function cancelSession(arenaId: string, id: string, reason: string, ctx: { actor: AuditActor }) {
  const scope = forArena(arenaId)
  const database = await db()
  const row = await database.transaction(async (tx) => {
    const [existing] = await tx.select().from(schema.sessions).where(scope.owns(schema.sessions, eq(schema.sessions.id, id), notDeleted)).for("update")
    if (!existing) throw new AppError("SESSION_NOT_FOUND", "Session not found")
    if (existing.status === "CANCELLED") return existing
    if (existing.status === "COMPLETED") throw new AppError("CONFLICT", "Completed sessions cannot be cancelled")
    const [updated] = await tx
      .update(schema.sessions)
      .set({ status: "CANCELLED", cancelledAt: new Date(), cancellationReason: reason, updatedAt: new Date() })
      .where(eq(schema.sessions.id, id))
      .returning()
    // Pending reservations are void; confirmed tickets are marked cancelled and
    // flagged for refund by finance (refunds go through the payment service).
    await tx
      .update(schema.bookings)
      .set({ status: "CANCELLED", cancelledAt: new Date(), cancellationReason: "Session cancelled", updatedAt: new Date() })
      .where(and(eq(schema.bookings.sessionId, id), eq(schema.bookings.status, "PENDING")))
    await tx
      .update(schema.tickets)
      .set({ status: "CANCELLED", cancelledAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.tickets.sessionId, id), eq(schema.tickets.status, "CONFIRMED")))
    return updated
  })
  await recordAudit(ctx.actor, {
    action: "session.cancel",
    entityType: "session",
    entityId: id,
    arenaId: row.arenaId,
    description: `Cancelled session "${row.title}"`,
    metadata: { reason },
  })
  return withStatus(row)
}

export async function deleteSession(arenaId: string, id: string, ctx: { actor: AuditActor }) {
  const scope = forArena(arenaId)
  const database = await db()
  const [row] = await database
    .update(schema.sessions)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(scope.owns(schema.sessions, eq(schema.sessions.id, id), eq(schema.sessions.bookedCount, 0), notDeleted))
    .returning()
  if (!row) throw new AppError("CONFLICT", "Sessions with confirmed bookings cannot be deleted; cancel them instead")
  await recordAudit(ctx.actor, { action: "session.delete", entityType: "session", entityId: id, arenaId: row.arenaId, description: `Deleted session "${row.title}"` })
  return row
}

/**
 * Housekeeping: persist time-derived transitions (IN_PROGRESS / COMPLETED)
 * so status filters in SQL stay accurate. Idempotent; called by the cron
 * endpoint and opportunistically by admin reads.
 */
/**
 * Adds someone to a session's waiting list. The session is resolved inside the
 * arena first, so a session id from another arena cannot be joined from here.
 * Re-submitting the same email is a no-op rather than an error.
 */
export async function joinWaitlist(
  arenaId: string,
  sessionId: string,
  input: { name: string; email: string; phone?: string | null }
) {
  const scope = forArena(arenaId)
  const session = await getSessionById(scope.arenaId, sessionId)
  const database = await db()
  await database
    .insert(schema.waitlistEntries)
    .values({
      arenaId: scope.arenaId,
      sessionId: session.id,
      name: input.name,
      email: input.email.toLowerCase(),
      phone: input.phone || null,
    })
    .onConflictDoNothing()
}

/** Platform-level cron: applies time-derived status transitions in every arena. */
export async function syncSessionLifecycle() {
  const database = await db()
  const now = new Date()
  const completed = await database
    .update(schema.sessions)
    .set({ status: "COMPLETED", updatedAt: now })
    .where(and(inArray(schema.sessions.status, ["PUBLISHED", "OPEN_FOR_BOOKING", "FULL", "IN_PROGRESS"]), lte(schema.sessions.endsAt, now), notDeleted))
    .returning({ id: schema.sessions.id })
  const inProgress = await database
    .update(schema.sessions)
    .set({ status: "IN_PROGRESS", updatedAt: now })
    .where(and(inArray(schema.sessions.status, ["PUBLISHED", "OPEN_FOR_BOOKING", "FULL"]), lte(schema.sessions.startsAt, now), gte(schema.sessions.endsAt, now), notDeleted))
    .returning({ id: schema.sessions.id })
  const open = await database
    .update(schema.sessions)
    .set({ status: "OPEN_FOR_BOOKING", updatedAt: now })
    .where(
      and(
        eq(schema.sessions.status, "PUBLISHED"),
        lte(schema.sessions.bookingOpensAt, now),
        gte(schema.sessions.bookingDeadline, now),
        sql`${schema.sessions.bookedCount} < ${schema.sessions.totalCapacity}`,
        notDeleted
      )
    )
    .returning({ id: schema.sessions.id })
  return { completed: completed.length, inProgress: inProgress.length, open: open.length }
}
