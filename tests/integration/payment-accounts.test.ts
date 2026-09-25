import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "@/server/db/schema"
import { createTestDb } from "../helpers/db"
import { getArena, makeArena, testActor } from "../helpers/fixtures"
import { encryptSecret, decryptSecret, maskSecret } from "@/server/crypto"
import { listPaymentAccounts, resolvePaymentAccount, savePaymentAccount, deletePaymentAccount } from "@/server/payments/accounts"
import { assertTransition, canTransition, isSettled } from "@/server/payments/state"

let ctx: Awaited<ReturnType<typeof createTestDb>>
let a: schema.Arena
let b: schema.Arena

beforeAll(async () => {
  ctx = await createTestDb()
  a = await getArena(ctx.db)
  b = await makeArena(ctx.db, "arena-b")
})
afterAll(async () => {
  await ctx.client.close()
})

describe("credentials at rest", () => {
  it("round-trips a secret and never stores it in the clear", () => {
    const secret = "sk_test_0123456789abcdef"
    const stored = encryptSecret(secret)
    expect(stored).not.toContain(secret)
    expect(stored.startsWith("v1.")).toBe(true)
    expect(decryptSecret(stored)).toBe(secret)
  })

  it("produces a different ciphertext every time, so equal keys are not detectable", () => {
    const one = encryptSecret("sk_test_same")
    const two = encryptSecret("sk_test_same")
    expect(one).not.toBe(two)
    expect(decryptSecret(one)).toBe(decryptSecret(two))
  })

  it("refuses a tampered ciphertext rather than returning wrong bytes", () => {
    const stored = encryptSecret("sk_test_tamper")
    const [v, iv, tag, body] = stored.split(".")
    const flipped = [v, iv, tag, Buffer.from(Buffer.from(body, "base64url").map((x, i) => (i === 0 ? x ^ 1 : x))).toString("base64url")].join(".")
    expect(() => decryptSecret(flipped)).toThrow()
  })

  it("masks a key for display without revealing it", () => {
    expect(maskSecret("sk_test_0123456789abcdef")).toBe("sk_tes…cdef")
    expect(maskSecret("short")).toBe("••••")
  })
})

describe("an arena's payment account", () => {
  it("never returns a secret to a caller that lists accounts", async () => {
    await savePaymentAccount(a.id, { provider: "paystack", secretKey: "sk_live_arena_a", publicKey: "pk_live_a", status: "ACTIVE" }, { actor: testActor })
    const [account] = await listPaymentAccounts(a.id)
    expect(account.secretKeySet).toBe(true)
    expect(account.publicKey).toBe("pk_live_a")
    expect(JSON.stringify(account)).not.toContain("sk_live_arena_a")
  })

  it("keeps the stored secret when only the public key is edited", async () => {
    await savePaymentAccount(a.id, { provider: "paystack", publicKey: "pk_live_a_v2" }, { actor: testActor })
    const row = (await ctx.db.query.arenaPaymentAccounts.findFirst({ where: eq(schema.arenaPaymentAccounts.arenaId, a.id) }))!
    expect(row.publicKey).toBe("pk_live_a_v2")
    expect(decryptSecret(row.secretKeyEncrypted!)).toBe("sk_live_arena_a")
  })

  it("is not visible to another arena", async () => {
    expect(await listPaymentAccounts(b.id)).toHaveLength(0)
    await expect(deletePaymentAccount(b.id, (await listPaymentAccounts(a.id))[0].id, { actor: testActor })).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
    expect(await listPaymentAccounts(a.id)).toHaveLength(1)
  })

  it("records the masked key in the audit trail, never the key", async () => {
    const entries = await ctx.db.query.auditLogs.findMany({ where: eq(schema.auditLogs.arenaId, a.id) })
    const entry = entries.find((e) => e.action.startsWith("payments.account"))!
    expect(JSON.stringify(entry.metadata)).toContain("sk_liv")
    expect(JSON.stringify(entry.metadata)).not.toContain("sk_live_arena_a")
  })
})

describe("which account an arena is paid into", () => {
  it("uses the arena's own credentials when it has them", async () => {
    const resolved = await resolvePaymentAccount(a.id, { provider: "paystack" })
    expect(resolved.source).toBe("arena")
    expect(resolved.secretKey).toBe("sk_live_arena_a")
    expect(resolved.publicKey).toBe("pk_live_a_v2")
    // Paystack signs webhooks with the secret key unless a separate one is set.
    expect(resolved.webhookSecret).toBe("sk_live_arena_a")
  })

  it("uses a separate webhook secret when one is stored", async () => {
    await savePaymentAccount(a.id, { provider: "paystack", webhookSecret: "whsec_a" }, { actor: testActor })
    const resolved = await resolvePaymentAccount(a.id, { provider: "paystack" })
    expect(resolved.webhookSecret).toBe("whsec_a")
    expect(resolved.secretKey).toBe("sk_live_arena_a")
  })

  it("refuses to take real money for an arena that has not connected an account", async () => {
    // This is the rule that keeps one tenant's customers from paying into
    // another tenant's account: past the first arena, there is no fallback.
    await expect(resolvePaymentAccount(b.id, { provider: "paystack" })).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
    })
    const [{ count }] = await ctx.db.select({ count: schema.arenas.id }).from(schema.arenas).limit(1)
    expect(count).toBeTruthy()
  })

  it("does not use an account that is not ACTIVE", async () => {
    await savePaymentAccount(b.id, { provider: "paystack", secretKey: "sk_live_arena_b", status: "PENDING" }, { actor: testActor })
    await expect(resolvePaymentAccount(b.id, { provider: "paystack" })).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
    })
    await savePaymentAccount(b.id, { provider: "paystack", status: "ACTIVE" }, { actor: testActor })
    const resolved = await resolvePaymentAccount(b.id, { provider: "paystack" })
    expect(resolved.secretKey).toBe("sk_live_arena_b")
  })

  it("gives each arena its own credentials, never the other's", async () => {
    const forA = await resolvePaymentAccount(a.id, { provider: "paystack" })
    const forB = await resolvePaymentAccount(b.id, { provider: "paystack" })
    expect(forA.secretKey).toBe("sk_live_arena_a")
    expect(forB.secretKey).toBe("sk_live_arena_b")
  })

  it("falls back to the platform only where nothing can be misdirected", async () => {
    // The mock provider charges nobody, so an arena with no account still
    // resolves under it.
    const resolved = await resolvePaymentAccount(b.id, { provider: "mock" })
    expect(resolved.source).toBe("platform")
    expect(resolved.secretKey).toBeNull()
  })
})

describe("the payment state machine", () => {
  it("allows the moves a payment actually makes", () => {
    expect(canTransition("PENDING", "PAID")).toBe(true)
    expect(canTransition("PENDING", "FAILED")).toBe(true)
    expect(canTransition("PAID", "REFUNDED")).toBe(true)
    // A provider confirming a late success for an attempt we gave up on.
    expect(canTransition("FAILED", "PAID")).toBe(true)
  })

  it("refuses to un-pay a customer who already holds a ticket", () => {
    expect(canTransition("PAID", "FAILED")).toBe(false)
    expect(canTransition("PAID", "PENDING")).toBe(false)
    expect(() => assertTransition("PAID", "FAILED", "late webhook")).toThrowError(/cannot become failed/)
  })

  it("treats a refund as final", () => {
    expect(canTransition("REFUNDED", "PAID")).toBe(false)
    expect(canTransition("REFUNDED", "FAILED")).toBe(false)
    expect(isSettled("REFUNDED")).toBe(true)
    expect(isSettled("PENDING")).toBe(false)
  })

  it("lets the same status arrive twice, because providers retry", () => {
    for (const status of ["PENDING", "PAID", "FAILED", "REFUNDED"] as const) {
      expect(canTransition(status, status), status).toBe(true)
    }
  })
})
