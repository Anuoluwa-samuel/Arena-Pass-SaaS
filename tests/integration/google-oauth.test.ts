import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { eq } from "drizzle-orm"
import { schema } from "@/server/db"
import { createTestDb } from "../helpers/db"
import { getArena } from "../helpers/fixtures"
import { hashPassword } from "@/server/auth/password"
import { createAuthSession } from "@/server/auth/session"
import { resolveGoogleCustomer } from "@/server/auth/google"

let ctx: Awaited<ReturnType<typeof createTestDb>>
/** Customer identity is per arena; these all act on the seeded one. */
let arena: Awaited<ReturnType<typeof getArena>>
beforeAll(async () => {
  ctx = await createTestDb()
  arena = await getArena(ctx.db)
})
afterAll(async () => {
  await ctx.client.close()
})

const claims = (sub: string, email: string, name = "Google User") => ({ sub, email, name })

describe("resolveGoogleCustomer", () => {
  it("creates a passwordless customer on first sign-in, then reuses it", async () => {
    const first = await resolveGoogleCustomer(arena.id, claims("sub-new", "new@example.com"))
    expect(first.created).toBe(true)
    expect(first.customer.passwordHash).toBeNull()
    expect(first.customer.googleSub).toBe("sub-new")

    const again = await resolveGoogleCustomer(arena.id, claims("sub-new", "new@example.com"))
    expect(again.created).toBe(false)
    expect(again.customer.id).toBe(first.customer.id)
  })

  it("finds a linked account by Google id even after the email changed", async () => {
    const { customer } = await resolveGoogleCustomer(arena.id, claims("sub-moved", "before@example.com"))
    const moved = await resolveGoogleCustomer(arena.id, claims("sub-moved", "after@example.com"))
    expect(moved.customer.id).toBe(customer.id)
  })

  it("links a guest checkout customer with the same email", async () => {
    const [guest] = await ctx.db.insert(schema.customers).values({ arenaId: arena.id, name: "Guest", email: "guest-link@example.com" }).returning()
    const result = await resolveGoogleCustomer(arena.id, claims("sub-guest", "guest-link@example.com"))
    expect(result.customer.id).toBe(guest.id)
    expect(result.passwordCleared).toBe(false)
  })

  it("on first link to a password account, clears the password and revokes its sessions", async () => {
    const [existing] = await ctx.db
      .insert(schema.customers)
      .values({ arenaId: arena.id, name: "Has Password", email: "haspw@example.com", passwordHash: await hashPassword("set-by-someone-1") })
      .returning()
    await createAuthSession("customer", existing.id, {})

    const result = await resolveGoogleCustomer(arena.id, claims("sub-haspw", "HasPw@example.com"))
    expect(result.customer.id).toBe(existing.id)
    expect(result.passwordCleared).toBe(true)
    expect(result.customer.passwordHash).toBeNull()
    const sessions = await ctx.db.query.authSessions.findMany({ where: eq(schema.authSessions.principalId, existing.id) })
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true)

    // A password set after linking is kept on later Google sign-ins.
    await ctx.db.update(schema.customers).set({ passwordHash: await hashPassword("owner-chosen-1") }).where(eq(schema.customers.id, existing.id))
    const later = await resolveGoogleCustomer(arena.id, claims("sub-haspw", "haspw@example.com"))
    expect(later.passwordCleared).toBe(false)
    expect(later.customer.passwordHash).not.toBeNull()
  })

  it("refuses an email already linked to a different Google account", async () => {
    await resolveGoogleCustomer(arena.id, claims("sub-owner", "taken@example.com"))
    await expect(resolveGoogleCustomer(arena.id, claims("sub-intruder", "taken@example.com"))).rejects.toMatchObject({ code: "OAUTH_FAILED" })
  })

  it("refuses a deactivated account", async () => {
    await ctx.db.insert(schema.customers).values({ arenaId: arena.id, name: "Off", email: "off@example.com", isActive: false })
    await expect(resolveGoogleCustomer(arena.id, claims("sub-off", "off@example.com"))).rejects.toMatchObject({ code: "ACCOUNT_DISABLED" })
  })
})
