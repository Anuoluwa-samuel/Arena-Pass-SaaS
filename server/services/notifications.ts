import "server-only"
import { and, desc, eq, sql, type SQL } from "drizzle-orm"
import { forArena } from "@/server/db/scoped"
import { db, schema } from "@/server/db"
import { getEmailChannel } from "@/server/notifications/email"
import { logger, serializeError } from "@/server/observability/logger"
import type { NotificationChannel } from "@/lib/domain/constants"

export interface NotifyInput {
  arenaId?: string | null
  recipientType: "user" | "customer" | "system"
  recipientId?: string | null
  recipientAddress?: string | null
  channel: NotificationChannel
  type: string
  title: string
  body: string
  html?: string
  data?: Record<string, unknown>
}

/**
 * Persists a notification then dispatches it through the channel adapter.
 * In-app notifications are "sent" the moment they are stored. Failures are
 * recorded on the row so the admin can see and retry them; they never
 * bubble up into the business operation that triggered them.
 */
export async function notify(input: NotifyInput) {
  const database = await db()
  const [row] = await database
    .insert(schema.notifications)
    .values({
      arenaId: input.arenaId ?? null,
      recipientType: input.recipientType,
      recipientId: input.recipientId ?? null,
      recipientAddress: input.recipientAddress ?? null,
      channel: input.channel,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data ?? null,
      status: input.channel === "IN_APP" ? "SENT" : "PENDING",
      sentAt: input.channel === "IN_APP" ? new Date() : null,
    })
    .returning()
  if (input.channel === "IN_APP") return row
  return dispatch(row.id, input.html)
}

export async function dispatch(notificationId: string, html?: string) {
  const database = await db()
  const row = await database.query.notifications.findFirst({ where: eq(schema.notifications.id, notificationId) })
  if (!row) return null
  try {
    if (row.channel === "EMAIL") {
      if (!row.recipientAddress) throw new Error("No recipient email")
      await getEmailChannel().send({ to: row.recipientAddress, subject: row.title, text: row.body, html: html ?? `<pre>${row.body}</pre>` })
    } else {
      // SMS / PUSH adapters plug in here; until configured they are recorded as failed so nothing is silently lost.
      throw new Error(`${row.channel} channel is not configured`)
    }
    const [sent] = await database.update(schema.notifications).set({ status: "SENT", sentAt: new Date(), error: null }).where(eq(schema.notifications.id, row.id)).returning()
    return sent
  } catch (err) {
    logger.warn("notification.failed", { id: row.id, channel: row.channel, error: serializeError(err) })
    const [failed] = await database.update(schema.notifications).set({ status: "FAILED", error: String((err as Error).message).slice(0, 500) }).where(eq(schema.notifications.id, row.id)).returning()
    return failed
  }
}

export async function listNotifications(arenaId: string, opts: { status?: string; channel?: string; page?: number; pageSize?: number } = {}) {
  const scope = forArena(arenaId)
  const database = await db()
  const page = opts.page ?? 1
  const pageSize = opts.pageSize ?? 20
  const where: SQL[] = [eq(schema.notifications.arenaId, scope.arenaId)]
  if (opts.status && opts.status !== "all") where.push(eq(schema.notifications.status, opts.status as schema.Notification["status"]))
  if (opts.channel && opts.channel !== "all") where.push(eq(schema.notifications.channel, opts.channel as schema.Notification["channel"]))
  const condition = and(...where)
  const [{ count }] = await database.select({ count: sql<number>`count(*)::int` }).from(schema.notifications).where(condition)
  const items = await database.select().from(schema.notifications).where(condition).orderBy(desc(schema.notifications.createdAt)).limit(pageSize).offset((page - 1) * pageSize)
  return { items, meta: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) } }
}

export async function markRead(arenaId: string, id: string) {
  const scope = forArena(arenaId)
  const database = await db()
  await database
    .update(schema.notifications)
    .set({ status: "READ", readAt: new Date() })
    .where(scope.owns(schema.notifications, eq(schema.notifications.id, id)))
}
