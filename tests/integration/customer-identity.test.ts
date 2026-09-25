import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"

/**
 * Sign-up and sign-in set a session cookie, which needs a request scope that
 * does not exist under vitest. An in-memory store lets these tests drive the
 * real auth functions rather than a reimplementation of them.
 */
const cookieJar = new Map<string, string>()
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    set: (name: string, value: string) => void cookieJar.set(name, value),
  }),
  headers: async () => new Headers(),
}))
import { eq } from "drizzle-orm"
import * as schema from "@/server/db/schema"
import { createTestDb } from "../helpers/db"
import { getArena, makeArena } from "../helpers/fixtures"
import { createAuthSession, loadCustomerPrincipal } from "@/server/auth/session"
import { signupCustomer, loginCustomer } from "@/server/auth/service"
import { requestEmailVerification, confirmEmail, VERIFICATION_TOKEN_TTL_MS } from "@/server/auth/email-verification"
import { hashPassword } from "@/server/auth/password"

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

const meta = { ip: "127.0.0.1", userAgent: "vitest" }

describe("a customer session belongs to one storefront", () => {
  it("resolves on its own arena and nowhere else", async () => {
    const customer = await signupCustomer(a.id, { name: "Ada", email: "ada@example.com", password: "a-strong-password" }, meta)
    const { session } = await createAuthSession("customer", customer.id, {})

    const here = await loadCustomerPrincipal(customer.id, a.id, session.id)
    expect(here?.email).toBe("ada@example.com")
    expect(here?.arenaId).toBe(a.id)

    // The same live session, presented on another arena's storefront. Treated
    // as signed out: they have no account there.
    expect(await loadCustomerPrincipal(customer.id, b.id, session.id)).toBeNull()
  })

  it("stops resolving once the account is deactivated", async () => {
    const customer = await signupCustomer(a.id, { name: "Gone", email: "gone@example.com", password: "a-strong-password" }, meta)
    const { session } = await createAuthSession("customer", customer.id, {})
    expect(await loadCustomerPrincipal(customer.id, a.id, session.id)).not.toBeNull()
    await ctx.db.update(schema.customers).set({ isActive: false }).where(eq(schema.customers.id, customer.id))
    expect(await loadCustomerPrincipal(customer.id, a.id, session.id)).toBeNull()
  })

  it("lets the same person hold separate accounts and sessions at two arenas", async () => {
    const atA = await signupCustomer(a.id, { name: "Dual", email: "dual@example.com", password: "a-strong-password" }, meta)
    const atB = await signupCustomer(b.id, { name: "Dual", email: "dual@example.com", password: "different-password" }, meta)
    expect(atA.id).not.toBe(atB.id)

    // Each password belongs to its own account.
    await expect(loginCustomer(b.id, "dual@example.com", "a-strong-password", meta)).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" })
    const signedIn = await loginCustomer(b.id, "dual@example.com", "different-password", meta)
    expect(signedIn.id).toBe(atB.id)
  })
})

describe("email confirmation", () => {
  it("stores only the hash of the token, never the token", async () => {
    const customer = await signupCustomer(a.id, { name: "Verify", email: "verify@example.com", password: "a-strong-password" }, meta)
    const deliver = await requestEmailVerification(a.id, customer.id)
    await deliver!()
    const rows = await ctx.db.query.emailVerificationTokens.findMany({ where: eq(schema.emailVerificationTokens.customerId, customer.id) })
    expect(rows).toHaveLength(1)
    expect(rows[0].tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(rows[0].arenaId).toBe(a.id)
  })

  it("refuses an unknown link", async () => {
    await expect(confirmEmail("not-a-real-token")).rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" })
  })

  it("refuses a link that has expired", async () => {
    const customer = await signupCustomer(a.id, { name: "Expired", email: "expired@example.com", password: "a-strong-password" }, meta)
    const { token } = await issueToken(a.id, customer.id)
    // Same real token, only older than its window.
    await ctx.db
      .update(schema.emailVerificationTokens)
      .set({ expiresAt: new Date(Date.now() - VERIFICATION_TOKEN_TTL_MS) })
      .where(eq(schema.emailVerificationTokens.customerId, customer.id))
    await expect(confirmEmail(token)).rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" })
    const still = await ctx.db.query.customers.findFirst({ where: eq(schema.customers.id, customer.id) })
    expect(still?.emailVerifiedAt).toBeNull()
  })

  it("refuses a link after the address it was issued for has changed", async () => {
    const customer = await signupCustomer(a.id, { name: "Moved", email: "moved@example.com", password: "a-strong-password" }, meta)
    const { token } = await issueToken(a.id, customer.id)
    await ctx.db.update(schema.customers).set({ email: "moved-again@example.com" }).where(eq(schema.customers.id, customer.id))
    // The link proves control of the old address, which is no longer the one
    // on the account.
    await expect(confirmEmail(token)).rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" })
  })

  it("marks the address confirmed, once", async () => {
    // Drive the real flow by intercepting the token through the email channel.
    const customer = await signupCustomer(a.id, { name: "Once", email: "once@example.com", password: "a-strong-password" }, meta)
    const before = await ctx.db.query.customers.findFirst({ where: eq(schema.customers.id, customer.id) })
    expect(before?.emailVerifiedAt).toBeNull()

    const { token } = await issueToken(a.id, customer.id)
    const confirmed = await confirmEmail(token)
    expect(confirmed.emailVerifiedAt).not.toBeNull()

    // Single use.
    await expect(confirmEmail(token)).rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" })
  })

  it("does not issue a link for an account that is already confirmed", async () => {
    const customer = await signupCustomer(a.id, { name: "Done", email: "done@example.com", password: "a-strong-password" }, meta)
    const { token } = await issueToken(a.id, customer.id)
    await confirmEmail(token)
    expect(await requestEmailVerification(a.id, customer.id)).toBeNull()
  })

  it("will not confirm an account from another arena's request", async () => {
    const customer = await signupCustomer(a.id, { name: "Scoped", email: "scoped@example.com", password: "a-strong-password" }, meta)
    expect(await requestEmailVerification(b.id, customer.id)).toBeNull()
  })

  it("retires an earlier link when a new one is requested", async () => {
    const customer = await signupCustomer(a.id, { name: "Retry", email: "retry@example.com", password: "a-strong-password" }, meta)
    const first = await issueToken(a.id, customer.id)
    const second = await issueToken(a.id, customer.id)
    await expect(confirmEmail(first.token)).rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" })
    await expect(confirmEmail(second.token)).resolves.toBeTruthy()
  })
})

/**
 * Issues a token and recovers the raw value the way the customer receives it —
 * by reading the link out of the email the channel was asked to send.
 */
async function issueToken(arenaId: string, customerId: string) {
  const { getEmailChannel } = await import("@/server/notifications/email")
  const channel = getEmailChannel()
  const original = channel.send.bind(channel)
  let captured = ""
  ;(channel as { send: typeof channel.send }).send = async (message) => {
    captured = message.text ?? ""
    return original(message)
  }
  try {
    const deliver = await requestEmailVerification(arenaId, customerId)
    await deliver!()
  } finally {
    ;(channel as { send: typeof channel.send }).send = original
  }
  const match = captured.match(/token=([A-Za-z0-9_-]+)/)
  if (!match) throw new Error(`No verification token in the email body: ${captured.slice(0, 200)}`)
  return { token: match[1] }
}
