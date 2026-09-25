import "server-only"
import { and, eq, isNull, ne, sql } from "drizzle-orm"
import { db, schema } from "@/server/db"
import { env } from "@/server/env"
import { AppError } from "@/server/http/errors"
import { decryptSecret, encryptSecret, maskSecret } from "@/server/crypto"
import { logger } from "@/server/observability/logger"
import { recordAudit, type AuditActor } from "@/server/services/audit"
import { MockPaymentProvider } from "./mock"
import { PaystackProvider } from "./paystack"
import type { PaymentProvider } from "./provider"

/**
 * Which payment account an arena's money goes into.
 *
 * Every arena is paid into its own provider account. The platform's
 * environment credentials remain as a fallback, but only where they cannot
 * mean "one tenant's customers paid into another tenant's account": with the
 * mock provider, or while the deployment has exactly one arena. Past that, an
 * arena with no account of its own cannot take payments at all — which is a
 * clear error an owner can fix, not a silent misdirection of funds.
 */

export interface ResolvedPaymentAccount {
  arenaId: string
  provider: string
  /** Where the credentials came from, for logs and for the settings screen. */
  source: "arena" | "platform"
  /** Safe to send to the browser. The secret never leaves the server. */
  publicKey: string | null
  secretKey: string | null
  /** Provider's signing secret for webhooks; falls back to the secret key, as Paystack does. */
  webhookSecret: string | null
}

async function arenaCount() {
  const database = await db()
  const [{ count }] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.arenas)
    .where(and(isNull(schema.arenas.deletedAt), ne(schema.arenas.status, "ARCHIVED")))
  return Number(count)
}

/**
 * @param opts.provider which provider to resolve for. Defaults to the
 * configured one; passed explicitly by tests so the refusal rule below can be
 * exercised without a production-shaped environment.
 */
export async function resolvePaymentAccount(
  arenaId: string,
  opts: { provider?: string } = {}
): Promise<ResolvedPaymentAccount> {
  const database = await db()
  const provider = opts.provider ?? env.PAYMENT_PROVIDER

  const account = await database.query.arenaPaymentAccounts.findFirst({
    where: and(
      eq(schema.arenaPaymentAccounts.arenaId, arenaId),
      eq(schema.arenaPaymentAccounts.provider, provider),
      eq(schema.arenaPaymentAccounts.status, "ACTIVE")
    ),
  })

  if (account?.secretKeyEncrypted) {
    const secretKey = decryptSecret(account.secretKeyEncrypted)
    return {
      arenaId,
      provider,
      source: "arena",
      publicKey: account.publicKey,
      secretKey,
      webhookSecret: account.webhookSecretEncrypted ? decryptSecret(account.webhookSecretEncrypted) : secretKey,
    }
  }

  // The mock provider takes no money, so the fallback is always safe there.
  if (provider === "mock") {
    return { arenaId, provider, source: "platform", publicKey: null, secretKey: null, webhookSecret: null }
  }

  if ((await arenaCount()) > 1) {
    logger.warn("payments.no_arena_account", { arenaId, provider })
    throw new AppError(
      "PAYMENT_PROVIDER_ERROR",
      "This arena has not connected a payment account yet. Add one in Settings → Payments before taking bookings."
    )
  }

  if (!env.PAYSTACK_SECRET_KEY) {
    throw new AppError("PAYMENT_PROVIDER_ERROR", "No payment account is configured")
  }
  return {
    arenaId,
    provider,
    source: "platform",
    publicKey: env.PAYSTACK_PUBLIC_KEY ?? null,
    secretKey: env.PAYSTACK_SECRET_KEY,
    webhookSecret: env.PAYSTACK_SECRET_KEY,
  }
}

let overrideForTests: PaymentProvider | undefined

/** The provider client for one arena, built from that arena's credentials. */
export async function getPaymentProviderForArena(arenaId: string): Promise<PaymentProvider> {
  if (overrideForTests) return overrideForTests
  const account = await resolvePaymentAccount(arenaId)
  if (account.provider === "paystack") return new PaystackProvider(account.secretKey!)
  return new MockPaymentProvider(env.APP_URL)
}

/** Test seam: forces every arena onto one provider stub. */
export function __setPaymentProviderForTests(provider: PaymentProvider | undefined) {
  overrideForTests = provider
}

// ---------------------------------------------------------------------------
// Management
// ---------------------------------------------------------------------------

/** What the settings screen may see: never a secret, only whether one is set. */
export interface PaymentAccountSummary {
  id: string
  provider: string
  status: schema.ArenaPaymentAccount["status"]
  publicKey: string | null
  providerAccountId: string | null
  secretKeySet: boolean
  webhookSecretSet: boolean
  lastVerifiedAt: Date | null
  updatedAt: Date
}

function toSummary(row: schema.ArenaPaymentAccount): PaymentAccountSummary {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    publicKey: row.publicKey,
    providerAccountId: row.providerAccountId,
    secretKeySet: !!row.secretKeyEncrypted,
    webhookSecretSet: !!row.webhookSecretEncrypted,
    lastVerifiedAt: row.lastVerifiedAt,
    updatedAt: row.updatedAt,
  }
}

export async function listPaymentAccounts(arenaId: string): Promise<PaymentAccountSummary[]> {
  const database = await db()
  const rows = await database.query.arenaPaymentAccounts.findMany({
    where: eq(schema.arenaPaymentAccounts.arenaId, arenaId),
  })
  return rows.map(toSummary)
}

export interface PaymentAccountInput {
  provider: string
  secretKey?: string
  publicKey?: string | null
  webhookSecret?: string | null
  providerAccountId?: string | null
  status?: schema.ArenaPaymentAccount["status"]
}

/**
 * Stores an arena's credentials. Secrets are encrypted here and never read
 * back out to a client; an omitted secret leaves the stored one untouched, so
 * an operator can edit the public key without re-typing the secret.
 */
export async function savePaymentAccount(arenaId: string, input: PaymentAccountInput, ctx: { actor: AuditActor }) {
  const database = await db()
  const existing = await database.query.arenaPaymentAccounts.findFirst({
    where: and(eq(schema.arenaPaymentAccounts.arenaId, arenaId), eq(schema.arenaPaymentAccounts.provider, input.provider)),
  })

  const patch: Partial<schema.ArenaPaymentAccount> = { updatedAt: new Date() }
  if (input.secretKey) patch.secretKeyEncrypted = encryptSecret(input.secretKey)
  if (input.webhookSecret !== undefined) {
    patch.webhookSecretEncrypted = input.webhookSecret ? encryptSecret(input.webhookSecret) : null
  }
  if (input.publicKey !== undefined) patch.publicKey = input.publicKey
  if (input.providerAccountId !== undefined) patch.providerAccountId = input.providerAccountId
  if (input.status) patch.status = input.status

  const row = existing
    ? (await database.update(schema.arenaPaymentAccounts).set(patch).where(eq(schema.arenaPaymentAccounts.id, existing.id)).returning())[0]
    : (
        await database
          .insert(schema.arenaPaymentAccounts)
          .values({ arenaId, provider: input.provider, status: input.status ?? "PENDING", ...patch })
          .returning()
      )[0]

  await recordAudit(ctx.actor, {
    action: existing ? "payments.account.update" : "payments.account.create",
    entityType: "arena_payment_account",
    entityId: row.id,
    arenaId,
    description: `${existing ? "Updated" : "Connected"} the ${input.provider} payment account`,
    // The masked key identifies which credential is in use without storing it.
    metadata: { provider: input.provider, status: row.status, secretKey: input.secretKey ? maskSecret(input.secretKey) : undefined },
  })
  return toSummary(row)
}

export async function deletePaymentAccount(arenaId: string, id: string, ctx: { actor: AuditActor }) {
  const database = await db()
  const [row] = await database
    .delete(schema.arenaPaymentAccounts)
    .where(and(eq(schema.arenaPaymentAccounts.id, id), eq(schema.arenaPaymentAccounts.arenaId, arenaId)))
    .returning()
  if (!row) throw new AppError("NOT_FOUND", "Payment account not found")
  await recordAudit(ctx.actor, {
    action: "payments.account.delete",
    entityType: "arena_payment_account",
    entityId: id,
    arenaId,
    description: `Disconnected the ${row.provider} payment account`,
  })
}
