import "server-only"
import { and, eq, gt, isNull, sql } from "drizzle-orm"
import { db, schema } from "@/server/db"
import { env } from "@/server/env"
import { AppError } from "@/server/http/errors"
import { getEmailChannel } from "@/server/notifications/email"
import { passwordResetEmail } from "@/server/notifications/templates"
import { logger, serializeError } from "@/server/observability/logger"
import { recordAudit } from "@/server/services/audit"
import { getSettings } from "@/server/services/settings"
import { hashPassword } from "./password"
import { revokeAllSessionsFor } from "./session"
import { randomToken, sha256 } from "./tokens"

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000

interface RequestMeta {
  ip?: string | null
  userAgent?: string | null
}

const INVALID_TOKEN_MESSAGE = "This reset link is invalid or has expired. Please request a new one."

/**
 * Looks up the account and, if it can be reset, returns a `deliver` callback
 * that issues the token and emails the link. Callers run `deliver` after the
 * response (next/server `after`), so the only work done before responding is
 * the same lookup for every email — known and unknown addresses look identical
 * in both body and timing. Returns null when there is nothing to send.
 */
export async function requestPasswordReset(
  arenaId: string,
  email: string, meta: RequestMeta): Promise<(() => Promise<void>) | null> {
  const database = await db()
  const customer = await database.query.customers.findFirst({
    where: and(
      sql`lower(${schema.customers.email}) = ${email.toLowerCase()}`,
      eq(schema.customers.arenaId, arenaId),
      isNull(schema.customers.deletedAt),
      eq(schema.customers.isActive, true)
    ),
  })
  if (!customer) return null

  return async () => {
    try {
      const token = randomToken(32)
      const now = new Date()
      // One live link at a time: a new request retires any earlier unused link.
      await database
        .update(schema.passwordResetTokens)
        .set({ usedAt: now })
        .where(and(eq(schema.passwordResetTokens.customerId, customer.id), isNull(schema.passwordResetTokens.usedAt)))
      await database.insert(schema.passwordResetTokens).values({
        customerId: customer.id,
        tokenHash: sha256(token),
        expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
        ipAddress: meta.ip ?? null,
      })

      const resetUrl = new URL("/reset-password", env.APP_URL)
      resetUrl.searchParams.set("token", token)
      // The arena's own name: a customer of one storefront must never receive
      // mail branded as the platform, or as another arena.
      const settings = await getSettings(arenaId)
      const message = passwordResetEmail({
        appName: settings.siteName || env.APP_NAME,
        customerName: customer.name,
        resetUrl: resetUrl.toString(),
        expiresInMinutes: RESET_TOKEN_TTL_MS / 60_000,
      })
      // Sent directly rather than through notify(): the notifications table is
      // visible to admins and would store a live credential in its body.
      await getEmailChannel().send({ to: customer.email, ...message })
    } catch (err) {
      logger.error("auth.password_reset_email_failed", { customerId: customer.id, error: serializeError(err) })
    }
  }
}

/**
 * Consumes a reset token and sets the new password. The token is claimed with a
 * conditional UPDATE so concurrent submissions of the same link can't both win.
 * Every existing session is revoked; the caller signs the customer back in.
 */
export async function resetPassword(token: string, password: string, meta: RequestMeta) {
  const database = await db()
  // Hash first so valid and invalid tokens cost the same.
  const passwordHash = await hashPassword(password)
  const now = new Date()
  const [claimed] = await database
    .update(schema.passwordResetTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(schema.passwordResetTokens.tokenHash, sha256(token)),
        isNull(schema.passwordResetTokens.usedAt),
        gt(schema.passwordResetTokens.expiresAt, now)
      )
    )
    .returning()
  if (!claimed) throw new AppError("INVALID_RESET_TOKEN", INVALID_TOKEN_MESSAGE)

  const customer = await database.query.customers.findFirst({
    where: and(eq(schema.customers.id, claimed.customerId), isNull(schema.customers.deletedAt)),
  })
  if (!customer || !customer.isActive) throw new AppError("INVALID_RESET_TOKEN", INVALID_TOKEN_MESSAGE)

  const [updated] = await database
    .update(schema.customers)
    .set({ passwordHash, updatedAt: now })
    .where(eq(schema.customers.id, customer.id))
    .returning()
  // Ends every device's session, including an intruder's if the owner is resetting after a compromise.
  await revokeAllSessionsFor("customer", customer.id)
  await database
    .update(schema.passwordResetTokens)
    .set({ usedAt: now })
    .where(and(eq(schema.passwordResetTokens.customerId, customer.id), isNull(schema.passwordResetTokens.usedAt)))
  await recordAudit(
    { type: "customer", id: customer.id, name: customer.name, ip: meta.ip },
    { action: "auth.password_reset", description: `${customer.name} reset their password`, entityType: "customer", entityId: customer.id, arenaId: customer.arenaId }
  )
  return updated
}
