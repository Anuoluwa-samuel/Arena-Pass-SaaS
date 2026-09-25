import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "@/server/db/schema"
import { createTestDb } from "../helpers/db"
import { getArena, getAdminUser, testActor } from "../helpers/fixtures"
import { registerArena, registerArenaSchema, getOnboardingState, launchArena } from "@/server/services/onboarding"
import { savePaymentAccount } from "@/server/payments/accounts"
import { createSession } from "@/server/services/sessions"
import { loadArenaMemberships } from "@/server/tenant/authorization"
import { resolveTenantFromHost } from "@/server/tenant/resolver"
import { requirePublicTenantFromRequest } from "@/server/tenant/context"

let ctx: Awaited<ReturnType<typeof createTestDb>>
let actor: typeof testActor

beforeAll(async () => {
  ctx = await createTestDb()
  await getArena(ctx.db)
  actor = { ...testActor, id: (await getAdminUser(ctx.db)).id }
})
afterAll(async () => {
  await ctx.client.close()
  vi.restoreAllMocks()
})

const registration = (over: Partial<Parameters<typeof registerArena>[0]> = {}) => ({
  name: "Ade Owner",
  email: "ade@lekki.test",
  password: "a-strong-password",
  organizationName: "Lekki Sports Ltd",
  arenaName: "Lekki Football Arena",
  slug: "lekki",
  city: "Lagos",
  ...over,
})

describe("registering an arena", () => {
  it("creates the identity, organization, arena and membership together", async () => {
    const { user, organization, arena } = await registerArena(registration())

    expect(organization.status).toBe("ACTIVE")
    expect(arena.organizationId).toBe(organization.id)
    // Not open yet: setup comes first.
    expect(arena.status).toBe("PENDING_SETUP")

    const memberships = await loadArenaMemberships(user.id)
    expect(memberships).toHaveLength(1)
    expect(memberships[0].arenaId).toBe(arena.id)
    expect(memberships[0].roleKey).toBe("ARENA_OWNER")

    // A storefront with no pages is a broken storefront.
    const pages = await ctx.db.query.cmsPages.findMany({ where: eq(schema.cmsPages.arenaId, arena.id) })
    expect(pages.length).toBeGreaterThan(0)
  })

  it("is not browsable by the public until it launches", async () => {
    const req = new Request("http://localhost:4000/", { headers: { host: "lekki.localhost" } })
    // Resolution succeeds — the arena exists — but the storefront is closed,
    // and indistinguishable from an address that matches nothing.
    expect((await resolveTenantFromHost("lekki.localhost"))?.arena.slug).toBe("lekki")
    await expect(requirePublicTenantFromRequest(req)).rejects.toMatchObject({ code: "ARENA_NOT_FOUND" })
  })

  it("refuses an address that is already taken", async () => {
    await expect(registerArena(registration({ email: "other@example.test" }))).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it("refuses a reserved or malformed address", () => {
    for (const slug of ["www", "api", "admin", "Lekki Arena", "ab", "-lekki", "lekki-", "a".repeat(41)]) {
      expect(registerArenaSchema.safeParse(registration({ slug })).success, slug).toBe(false)
    }
  })

  it("lets an existing operator open a second arena without touching their password", async () => {
    const before = (await ctx.db.query.users.findFirst({ where: eq(schema.users.email, "ade@lekki.test") }))!
    const { user, arena } = await registerArena(registration({ slug: "ikeja", arenaName: "Ikeja Arena", password: "a-completely-different-password" }))
    expect(user.id).toBe(before.id)
    // The password in the form is ignored: otherwise knowing an address would
    // be a way to overwrite somebody's credentials.
    const after = (await ctx.db.query.users.findFirst({ where: eq(schema.users.id, before.id) }))!
    expect(after.passwordHash).toBe(before.passwordHash)

    const memberships = await loadArenaMemberships(user.id)
    expect(memberships.map((m) => m.arenaSlug).sort()).toEqual(["ikeja", "lekki"])
    expect(arena.id).not.toBe(memberships.find((m) => m.arenaSlug === "lekki")!.arenaId)
  })
})

describe("the setup checklist", () => {
  let arenaId: string

  beforeAll(async () => {
    arenaId = (await ctx.db.query.arenas.findFirst({ where: eq(schema.arenas.slug, "lekki") }))!.id
  })

  it("starts with nothing done and refuses to launch", async () => {
    const state = await getOnboardingState(arenaId)
    expect(state.launched).toBe(false)
    expect(state.canLaunch).toBe(false)
    expect(state.percent).toBe(0)
    expect(state.tasks.filter((t) => t.done)).toHaveLength(0)
    await expect(launchArena(arenaId, { actor })).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it("counts work done anywhere, not only through the wizard", async () => {
    // A session created from the sessions screen still ticks the box.
    const now = Date.now()
    await createSession(
      {
        title: "Opening night", venue: "Pitch A",
        startsAt: new Date(now + 6 * 3_600_000), endsAt: new Date(now + 8 * 3_600_000),
        bookingOpensAt: new Date(now - 3_600_000), bookingDeadline: new Date(now + 5 * 3_600_000),
        teamsCount: 8, playersPerTeam: 4, ticketPriceMajor: 5000, publish: true,
      },
      { arenaId, actor }
    )
    const state = await getOnboardingState(arenaId)
    expect(state.tasks.find((t) => t.step === "first_session")!.done).toBe(true)
    // Still cannot launch: payment is the other required step.
    expect(state.canLaunch).toBe(false)
    expect(state.currentStep).toBe("branding")
  })

  it("will not count a payment account that is not usable", async () => {
    await savePaymentAccount(arenaId, { provider: "paystack", status: "PENDING", secretKey: "sk_test_pending" }, { actor })
    expect((await getOnboardingState(arenaId)).tasks.find((t) => t.step === "payments")!.done).toBe(false)

    await savePaymentAccount(arenaId, { provider: "paystack", status: "ACTIVE" }, { actor })
    const state = await getOnboardingState(arenaId)
    expect(state.tasks.find((t) => t.step === "payments")!.done).toBe(true)
    expect(state.canLaunch).toBe(true)
    expect(state.percent).toBe(100)
  })

  it("opens the storefront on launch, and only then", async () => {
    const req = new Request("http://localhost:4000/", { headers: { host: "lekki.localhost" } })
    await expect(requirePublicTenantFromRequest(req)).rejects.toMatchObject({ code: "ARENA_NOT_FOUND" })

    const state = await launchArena(arenaId, { actor })
    expect(state.launched).toBe(true)

    const tenant = await requirePublicTenantFromRequest(req)
    expect(tenant.arena.status).toBe("ACTIVE")
    const row = (await ctx.db.query.arenas.findFirst({ where: eq(schema.arenas.id, arenaId) }))!
    expect(row.onboardingStep).toBe("launched")
    expect(row.launchedAt).not.toBeNull()
  })

  it("is idempotent once launched", async () => {
    const again = await launchArena(arenaId, { actor })
    expect(again.launched).toBe(true)
    expect(again.percent).toBe(100)
  })

  it("does not leak another arena's progress", async () => {
    const ikeja = (await ctx.db.query.arenas.findFirst({ where: eq(schema.arenas.slug, "ikeja") }))!
    const state = await getOnboardingState(ikeja.id)
    expect(state.launched).toBe(false)
    // Lekki's session and payment account are not Ikeja's.
    expect(state.tasks.find((t) => t.step === "first_session")!.done).toBe(false)
    expect(state.tasks.find((t) => t.step === "payments")!.done).toBe(false)
  })
})
