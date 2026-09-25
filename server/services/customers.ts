import "server-only"
import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm"
import { db, schema } from "@/server/db"
import { forArena } from "@/server/db/scoped"
import { notFound } from "@/server/http/errors"

/**
 * Customers belong to one arena. The email is not yet unique per arena — the
 * index is still global until the identity migration — so the lookup below is
 * scoped to the arena and the row it returns can only ever be this arena's.
 */
export async function upsertCustomerByEmail(arenaId: string, input: { name: string; email: string; phone?: string | null }) {
  const scope = forArena(arenaId)
  const database = await db()
  const email = input.email.trim().toLowerCase()
  const existing = await database.query.customers.findFirst({
    where: and(sql`lower(${schema.customers.email}) = ${email}`, eq(schema.customers.arenaId, scope.arenaId)),
  })
  if (existing) {
    // Keep the freshest contact details, never downgrade a registered account.
    const [updated] = await database
      .update(schema.customers)
      .set({ name: existing.passwordHash ? existing.name : input.name, phone: input.phone || existing.phone, updatedAt: new Date() })
      .where(eq(schema.customers.id, existing.id))
      .returning()
    return updated
  }
  const [created] = await database
    .insert(schema.customers)
    .values({ arenaId: scope.arenaId, name: input.name, email, phone: input.phone || null })
    .returning()
  return created
}

export async function listCustomers(arenaId: string, opts: { q?: string; page?: number; pageSize?: number } = {}) {
  const scope = forArena(arenaId)
  const database = await db()
  const page = opts.page ?? 1
  const pageSize = opts.pageSize ?? 20
  const where: SQL[] = [eq(schema.customers.arenaId, scope.arenaId), isNull(schema.customers.deletedAt)]
  if (opts.q) where.push(or(ilike(schema.customers.name, `%${opts.q}%`), ilike(schema.customers.email, `%${opts.q}%`), ilike(schema.customers.phone, `%${opts.q}%`))!)
  const condition = and(...where)
  const [{ count }] = await database.select({ count: sql<number>`count(*)::int` }).from(schema.customers).where(condition)
  const items = await database
    .select({
      customer: schema.customers,
      // Scoped to this arena: a person who plays at two arenas must not have
      // the other arena's spend shown here.
      ticketCount: sql<number>`(select count(*)::int from ${schema.tickets} t where t.customer_id = ${schema.customers.id} and t.arena_id = ${scope.arenaId})`,
      totalSpent: sql<number>`coalesce((select sum(t.price)::int from ${schema.tickets} t where t.customer_id = ${schema.customers.id} and t.arena_id = ${scope.arenaId} and t.status in ('CONFIRMED','USED')), 0)`,
    })
    .from(schema.customers)
    .where(condition)
    .orderBy(desc(schema.customers.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
  return { items, meta: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) } }
}

export async function getCustomerDetail(arenaId: string, id: string) {
  const scope = forArena(arenaId)
  const database = await db()
  const customer = await database.query.customers.findFirst({
    where: and(eq(schema.customers.id, id), eq(schema.customers.arenaId, scope.arenaId), isNull(schema.customers.deletedAt)),
  })
  if (!customer) throw notFound("Customer")
  const ticketRows = await database
    .select({ ticket: schema.tickets, session: { id: schema.sessions.id, title: schema.sessions.title, startsAt: schema.sessions.startsAt, venue: schema.sessions.venue } })
    .from(schema.tickets)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.tickets.sessionId))
    .where(scope.owns(schema.tickets, eq(schema.tickets.customerId, id)))
    .orderBy(desc(schema.tickets.purchasedAt))
  return { customer, tickets: ticketRows }
}

export async function updateCustomer(
  arenaId: string,
  id: string,
  patch: { name?: string; phone?: string | null; isActive?: boolean }
) {
  const scope = forArena(arenaId)
  const database = await db()
  // The arena is part of the WHERE, not checked afterwards: another arena's
  // customer matches no row and the update is a no-op rather than a write.
  const [row] = await database
    .update(schema.customers)
    .set({ ...patch, updatedAt: new Date() })
    .where(scope.owns(schema.customers, eq(schema.customers.id, id)))
    .returning()
  if (!row) throw notFound("Customer")
  return row
}
