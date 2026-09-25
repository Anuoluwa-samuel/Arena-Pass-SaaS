import "server-only"
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm"
import { forArena } from "@/server/db/scoped"
import { db, schema } from "@/server/db"

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Dashboard KPIs + chart series. All money in minor units. */
export async function getDashboardOverview(arenaId: string, opts: { days?: number } = {}) {
  const database = await db()
  const days = opts.days ?? 30
  const now = new Date()
  const today = startOfDay(now)
  const since = new Date(today.getTime() - (days - 1) * 86_400_000)
  const paidTicket = inArray(schema.tickets.status, ["CONFIRMED", "USED"])

  const [[todaySales], [totals], [ticketCounts], [availability], [upcoming]] = await Promise.all([
    database.select({ revenue: sql<number>`coalesce(sum(${schema.tickets.price}), 0)::int`, count: sql<number>`count(*)::int` }).from(schema.tickets).where(and(eq(schema.tickets.arenaId, arenaId), paidTicket, gte(schema.tickets.purchasedAt, today))),
    database.select({ revenue: sql<number>`coalesce(sum(${schema.tickets.price}), 0)::int`, count: sql<number>`count(*)::int` }).from(schema.tickets).where(and(eq(schema.tickets.arenaId, arenaId), paidTicket, gte(schema.tickets.purchasedAt, since))),
    database
      .select({
        confirmed: sql<number>`count(*) filter (where ${schema.tickets.status} = 'CONFIRMED')::int`,
        used: sql<number>`count(*) filter (where ${schema.tickets.status} = 'USED')::int`,
        refunded: sql<number>`count(*) filter (where ${schema.tickets.status} = 'REFUNDED')::int`,
        cancelled: sql<number>`count(*) filter (where ${schema.tickets.status} = 'CANCELLED')::int`,
      })
      .from(schema.tickets)
      .where(eq(schema.tickets.arenaId, arenaId)),
    database
      .select({ available: sql<number>`coalesce(sum(${schema.sessions.totalCapacity} - ${schema.sessions.bookedCount} - ${schema.sessions.heldCount}), 0)::int` })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.arenaId, arenaId), isNull(schema.sessions.deletedAt), inArray(schema.sessions.status, ["PUBLISHED", "OPEN_FOR_BOOKING"]), gte(schema.sessions.startsAt, now))),
    database.select({ count: sql<number>`count(*)::int` }).from(schema.sessions).where(and(eq(schema.sessions.arenaId, arenaId), isNull(schema.sessions.deletedAt), inArray(schema.sessions.status, ["PUBLISHED", "OPEN_FOR_BOOKING", "FULL"]), gte(schema.sessions.startsAt, now))),
  ])

  const daily = await database
    .select({ day: sql<string>`to_char(date_trunc('day', ${schema.tickets.purchasedAt}), 'YYYY-MM-DD')`, tickets: sql<number>`count(*)::int`, revenue: sql<number>`coalesce(sum(${schema.tickets.price}), 0)::int` })
    .from(schema.tickets)
    .where(and(eq(schema.tickets.arenaId, arenaId), paidTicket, gte(schema.tickets.purchasedAt, since)))
    .groupBy(sql`1`)
    .orderBy(sql`1`)
  const dailyMap = new Map(daily.map((d) => [d.day, d]))
  const series = Array.from({ length: days }, (_, i) => {
    const d = new Date(since.getTime() + i * 86_400_000)
    const key = d.toISOString().slice(0, 10)
    const hit = dailyMap.get(key)
    return { date: key, tickets: Number(hit?.tickets ?? 0), revenue: Number(hit?.revenue ?? 0) }
  })

  const occupancy = await database
    .select({ id: schema.sessions.id, title: schema.sessions.title, startsAt: schema.sessions.startsAt, bookedCount: schema.sessions.bookedCount, totalCapacity: schema.sessions.totalCapacity, status: schema.sessions.status })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.arenaId, arenaId), isNull(schema.sessions.deletedAt), inArray(schema.sessions.status, ["PUBLISHED", "OPEN_FOR_BOOKING", "FULL", "IN_PROGRESS"]), gte(schema.sessions.endsAt, now)))
    .orderBy(schema.sessions.startsAt)
    .limit(8)

  const popular = await database
    .select({ id: schema.sessions.id, title: schema.sessions.title, startsAt: schema.sessions.startsAt, sold: sql<number>`count(${schema.tickets.id})::int`, revenue: sql<number>`coalesce(sum(${schema.tickets.price}), 0)::int` })
    .from(schema.sessions)
    .innerJoin(schema.tickets, and(eq(schema.tickets.sessionId, schema.sessions.id), paidTicket))
    .where(and(eq(schema.sessions.arenaId, arenaId), gte(schema.tickets.purchasedAt, since)))
    .groupBy(schema.sessions.id, schema.sessions.title, schema.sessions.startsAt)
    .orderBy(desc(sql`count(${schema.tickets.id})`))
    .limit(5)

  const payments = await database
    .select({ status: schema.payments.status, count: sql<number>`count(*)::int`, amount: sql<number>`coalesce(sum(${schema.payments.amount}), 0)::int` })
    .from(schema.payments)
    .where(and(eq(schema.payments.arenaId, arenaId), gte(schema.payments.createdAt, since)))
    .groupBy(schema.payments.status)

  const [attendance] = await database
    .select({ admitted: sql<number>`count(*) filter (where ${schema.tickets.status} = 'USED')::int`, eligible: sql<number>`count(*) filter (where ${schema.tickets.status} in ('USED','CONFIRMED'))::int` })
    .from(schema.tickets)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.tickets.sessionId))
    .where(and(eq(schema.tickets.arenaId, arenaId), lt(schema.sessions.endsAt, now), gte(schema.sessions.endsAt, since)))

  return {
    period: { days, since: since.toISOString(), until: now.toISOString() },
    kpis: {
      todayRevenue: Number(todaySales.revenue),
      todayTickets: Number(todaySales.count),
      periodRevenue: Number(totals.revenue),
      periodTickets: Number(totals.count),
      availableSlots: Number(availability.available),
      upcomingSessions: Number(upcoming.count),
      ticketsByStatus: { confirmed: Number(ticketCounts.confirmed), used: Number(ticketCounts.used), refunded: Number(ticketCounts.refunded), cancelled: Number(ticketCounts.cancelled) },
    },
    series,
    occupancy: occupancy.map((o) => ({ ...o, percent: o.totalCapacity ? Math.round((o.bookedCount / o.totalCapacity) * 100) : 0 })),
    popular,
    payments: payments.map((p) => ({ status: p.status, count: Number(p.count), amount: Number(p.amount) })),
    attendance: { admitted: Number(attendance?.admitted ?? 0), eligible: Number(attendance?.eligible ?? 0) },
  }
}

/** Recent activity feed: the audit trail is the source of truth. */
export async function getRecentActivity(arenaId: string, limit = 12) {
  const database = await db()
  return database
    .select()
    .from(schema.auditLogs)
    .where(and(eq(schema.auditLogs.arenaId, arenaId), inArray(schema.auditLogs.action, ["ticket.issue", "booking.create", "session.create", "session.publish", "session.cancel", "payment.refund", "ticket.admit", "cms.page.publish", "user.create"])))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(limit)
}

export async function listAuditLogs(arenaId: string, opts: { q?: string; action?: string; actorId?: string; from?: Date; to?: Date; page?: number; pageSize?: number } = {}) {
  const scope = forArena(arenaId)
  const database = await db()
  const page = opts.page ?? 1
  const pageSize = opts.pageSize ?? 30
  const conditions = [
    eq(schema.auditLogs.arenaId, scope.arenaId),
    opts.action && opts.action !== "all" ? sql`${schema.auditLogs.action} like ${opts.action + "%"}` : undefined,
    opts.actorId ? eq(schema.auditLogs.actorId, opts.actorId) : undefined,
    opts.from ? gte(schema.auditLogs.createdAt, opts.from) : undefined,
    opts.to ? lt(schema.auditLogs.createdAt, opts.to) : undefined,
    opts.q ? sql`(${schema.auditLogs.description} ilike ${"%" + opts.q + "%"} or ${schema.auditLogs.actorName} ilike ${"%" + opts.q + "%"} or ${schema.auditLogs.entityId} ilike ${"%" + opts.q + "%"})` : undefined,
  ].filter(Boolean)
  const condition = and(...conditions)
  const [{ count }] = await database.select({ count: sql<number>`count(*)::int` }).from(schema.auditLogs).where(condition)
  const items = await database.select().from(schema.auditLogs).where(condition).orderBy(desc(schema.auditLogs.createdAt)).limit(pageSize).offset((page - 1) * pageSize)
  return { items, meta: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) } }
}
