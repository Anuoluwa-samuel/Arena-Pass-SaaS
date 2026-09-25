import "server-only"
import { and, eq, gt, isNull, sql } from "drizzle-orm"
import { db, schema } from "@/server/db"
import { env } from "@/server/env"
import { AppError } from "@/server/http/errors"
import { getEmailChannel } from "@/server/notifications/email"
import { emailVerificationEmail } from "@/server/notifications/templates"
import { logger, serializeError } from "@/server/observability/logger"
import { recordAudit } from "@/server/services/audit"
import { getSettings } from "@/server/services/settings"
import { randomToken, sha256 } from "./tokens"

/**
 * Email confirmation for customer accounts.
 *
 * Modelled on the password-reset flow: only the SHA-256 of the token is
 * stored, one live link at a time, claimed with a conditional UPDATE so two
 * submissions of the same link cannot both win.
 *
 * The token records the address it was issued for, so a link sent to an old
 * address cannot confirm a new one after the customer changes their email.
 */

export const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

const INVALID_TOKEN_MESSAGE = "This confirmation link is invalid or has expired. Please request a new one."

/**
 * Issues a token and returns a `deliver` callback the caller runs after
 * responding, so signing up costs the same whether or not an email goes out.
 * Returns null when there is nothing to send — no account, or already
 * confirmed.
 */
export async function requestEmailVerification(
  arenaId: string,
  customerId: string,
  meta: { ip?: string | null } = {}
): Promise<(() => Promise<void>) | null> {
  const database = await db()
  const customer = await database.query.customers.findFirst({
    where: and(
      eq(schema.customers.id, customerId),
      eq(schema.customers.arenaId, arenaId),
      isNull(schema.customers.deletedAt),
      isNull(schema.customers.emailVerifiedAt)
    ),
  })
  if (!customer) return null

  return async () => {
    try {
      const token = randomToken(32)
      const now = new Date()
      await database
        .update(schema.emailVerificationTokens)
        .set({ usedAt: now })
        .where(and(eq(schema.emailVerificationTokens.customerId, customer.id), isNull(schema.emailVerificationTokens.usedAt)))
      await database.insert(schema.emailVerificationTokens).values({
        arenaId: customer.arenaId,
        customerId: customer.id,
        tokenHash: sha256(token),
        email: customer.email.toLowerCase(),
        expiresAt: new Date(now.getTime() + VERIFICATION_TOKEN_TTL_MS),
      })

      const settings = await getSettings(customer.arenaId)
      const verifyUrl = new URL("/verify-email", env.APP_URL)
      verifyUrl.searchParams.set("token", token)
      const message = emailVerificationEmail({
        // The arena's own name, not the platform's: this is their storefront.
        appName: settings.siteName || env.APP_NAME,
        customerName: customer.name,
        verifyUrl: verifyUrl.toString(),
        expiresInHours: VERIFICATION_TOKEN_TTL_MS / 3_600_000,
      })
      // Sent directly rather than through notify(): the notifications table is
      // visible to admins and would store a live credential in its body.
      await getEmailChannel().send({ to: customer.email, ...message })
    } catch (err) {
      logger.error("auth.verification_email_failed", { customerId: customer.id, error: serializeError(err) })
    }
  }
}

/**
 * Consumes a token and marks the address confirmed. The arena is taken from
 * the token's own row, not from the request: the link arrives from an email
 * client that carries no storefront context.
 */
export async function confirmEmail(token: string, meta: { ip?: string | null } = {}) {
  const database = await db()
  const now = new Date()
  const [claimed] = await database
    .update(schema.emailVerificationTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(schema.emailVerificationTokens.tokenHash, sha256(token)),
        isNull(schema.emailVerificationTokens.usedAt),
        gt(schema.emailVerificationTokens.expiresAt, now)
      )
    )
    .returning()
  if (!claimed) throw new AppError("INVALID_RESET_TOKEN", INVALID_TOKEN_MESSAGE)

  const [customer] = await database
    .update(schema.customers)
    .set({ emailVerifiedAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.customers.id, claimed.customerId),
        eq(schema.customers.arenaId, claimed.arenaId),
        // The address must still be the one the link was issued for.
        sql`lower(${schema.customers.email}) = ${claimed.email}`,
        isNull(schema.customers.deletedAt)
      )
    )
    .returning()
  if (!customer) throw new AppError("INVALID_RESET_TOKEN", INVALID_TOKEN_MESSAGE)

  await recordAudit(
    { type: "customer", id: customer.id, name: customer.name, ip: meta.ip },
    { action: "auth.email_verified", arenaId: customer.arenaId, entityType: "customer", entityId: customer.id, description: `${customer.name} confirmed their email address` }
  )
  return customer
}
