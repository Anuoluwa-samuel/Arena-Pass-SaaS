import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { schema } from "@/server/db"
import { createTestDb } from "../helpers/db"
import { getArena } from "../helpers/fixtures"
import { hashPassword, verifyPassword } from "@/server/auth/password"
import { requestPasswordReset, resetPassword } from "@/server/auth/password-reset"
import { createAuthSession } from "@/server/auth/session"
import { sha256 } from "@/server/auth/tokens"
import { getEmailChannel, type EmailMessage } from "@/server/notifications/email"

let ctx: Awaited<ReturnType<typeof createTestDb>>
/** Customer identity is per arena; these all act on the seeded one. */
let arena: Awaited<ReturnType<typeof getArena>>
const sent: EmailMessage[] = []
beforeAll(async () => {
  ctx = await createTestDb()
  arena = await getArena(ctx.db)
  vi.spyOn(getEmailChannel(), "send").mockImplementation(async (msg) => {
    sent.push(msg)
    return {}
  })
})
afterAll(async () => {
  await ctx.client.close()
})

const meta = { ip: "127.0.0.1", userAgent: "vitest" }

async function makeCustomer(email: string, overrides: Partial<typeof schema.customers.$inferInsert> = {}) {
  const [row] = await ctx.db
    .insert(schema.customers)
    .values({ arenaId: arena.id, name: "Reset Tester", email, passwordHash: await hashPassword("old-password-123"), ...overrides })
    .returning()
  return row
}

/** Runs the deferred delivery and returns the raw token from the emailed link. */
async function requestToken(email: string) {
  const deliver = await requestPasswordReset(arena.id, email, meta)
  if (!deliver) return null
  const before = sent.length
  await deliver()
  const msg = sent[before]
  const token = new URL(msg.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!
  return { token, msg }
}

describe("password reset", () => {
  it("does nothing for an unknown email", async () => {
    const before = sent.length
    expect(await requestPasswordReset(arena.id, "nobody@example.com", meta)).toBeNull()
    expect(sent.length).toBe(before)
  })

  it("does nothing for a deactivated account", async () => {
    await makeCustomer("disabled@example.com", { isActive: false })
    expect(await requestPasswordReset(arena.id, "disabled@example.com", meta)).toBeNull()
  })

  it("emails a link and stores only the token's hash", async () => {
    const customer = await makeCustomer("store@example.com")
    const { token, msg } = (await requestToken("STORE@example.com"))!
    expect(msg.to).toBe("store@example.com")
    expect(msg.text).toContain("/reset-password?token=")
    const rows = await ctx.db.query.passwordResetTokens.findMany({ where: eq(schema.passwordResetTokens.customerId, customer.id) })
    expect(rows).toHaveLength(1)
    expect(rows[0].tokenHash).toBe(sha256(token))
    expect(rows[0].tokenHash).not.toContain(token)
  })

  it("sets the new password, revokes every session, and is single-use", async () => {
    const customer = await makeCustomer("reset@example.com")
    await createAuthSession("customer", customer.id, meta)
    await createAuthSession("customer", customer.id, meta)
    const { token } = (await requestToken("reset@example.com"))!

    await resetPassword(token, "brand-new-password", meta)

    const updated = await ctx.db.query.customers.findFirst({ where: eq(schema.customers.id, customer.id) })
    expect(await verifyPassword("brand-new-password", updated!.passwordHash)).toBe(true)
    expect(await verifyPassword("old-password-123", updated!.passwordHash)).toBe(false)
    const sessions = await ctx.db.query.authSessions.findMany({ where: eq(schema.authSessions.principalId, customer.id) })
    expect(sessions.length).toBe(2)
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true)

    await expect(resetPassword(token, "another-password-1", meta)).rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" })
  })

  it("rejects an expired link", async () => {
    const customer = await makeCustomer("expired@example.com")
    const { token } = (await requestToken("expired@example.com"))!
    await ctx.db.update(schema.passwordResetTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.passwordResetTokens.customerId, customer.id))
    await expect(resetPassword(token, "brand-new-password", meta)).rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" })
  })

  it("retires an earlier link when a new one is requested", async () => {
    await makeCustomer("twice@example.com")
    const first = (await requestToken("twice@example.com"))!
    const second = (await requestToken("twice@example.com"))!
    await expect(resetPassword(first.token, "brand-new-password", meta)).rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" })
    await expect(resetPassword(second.token, "brand-new-password", meta)).resolves.toMatchObject({ email: "twice@example.com" })
  })

  it("lets only one of two concurrent submissions of the same link succeed", async () => {
    await makeCustomer("race@example.com")
    const { token } = (await requestToken("race@example.com"))!
    const results = await Promise.allSettled([resetPassword(token, "password-one-1", meta), resetPassword(token, "password-two-2", meta)])
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
  })

  it("lets a passwordless (guest or Google-only) customer set a password", async () => {
    const customer = await makeCustomer("guest@example.com", { passwordHash: null })
    const { token } = (await requestToken("guest@example.com"))!
    await resetPassword(token, "first-password-1", meta)
    const updated = await ctx.db.query.customers.findFirst({ where: eq(schema.customers.id, customer.id) })
    expect(await verifyPassword("first-password-1", updated!.passwordHash)).toBe(true)
  })

  it("rejects a made-up token", async () => {
    await expect(resetPassword("this-token-was-never-issued-anywhere", "brand-new-password", meta)).rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" })
  })
})
