import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { and, eq, isNull } from "drizzle-orm"
import * as schema from "@/server/db/schema"
import { createTestDb } from "../helpers/db"
import { getArena, getAdminUser, makeArena, testActor } from "../helpers/fixtures"
import {
  IMPERSONATION_TTL_MS,
  endImpersonation,
  getActiveImpersonation,
  isFeatureEnabled,
  listFeatureFlagsForArena,
  listPlatformArenas,
  setArenaStatus,
  setFeatureFlag,
  startImpersonation,
} from "@/server/services/platform"
import { authorizeArena, loadArenaMemberships, loadPlatformAccess, type AuthorizableUser } from "@/server/tenant/authorization"
import { loadUserPrincipal } from "@/server/auth/session"
import { requirePublicTenantFromRequest } from "@/server/tenant/context"

let ctx: Awaited<ReturnType<typeof createTestDb>>
let main: schema.Arena
let other: schema.Arena
let platformUserId: string
let actor: typeof testActor

beforeAll(async () => {
  ctx = await createTestDb()
  main = await getArena(ctx.db)
  other = await makeArena(ctx.db, "arena-b")
  const admin = await getAdminUser(ctx.db)
  platformUserId = admin.id
  actor = { ...testActor, id: admin.id }
})
afterAll(async () => {
  await ctx.client.close()
})

const principal = async (userId: string): Promise<AuthorizableUser> => {
  const user = (await ctx.db.query.users.findFirst({ where: eq(schema.users.id, userId) }))!
  return { id: user.id, memberships: await loadArenaMemberships(user.id), platform: await loadPlatformAccess(user.platformRoleId) }
}

describe("the platform view spans tenants, and only the platform has it", () => {
  it("lists every arena regardless of membership", async () => {
    const arenas = await listPlatformArenas()
    expect(arenas.map((a) => a.slug).sort()).toEqual(["arena-b", "main"])
    expect(arenas.find((a) => a.slug === "main")!.organizationName).toBeTruthy()
  })

  it("suspending an arena closes its storefront but not its admin", async () => {
    const req = new Request("http://localhost:4000/", { headers: { host: "arena-b.localhost" } })
    expect((await requirePublicTenantFromRequest(req)).arena.status).toBe("ACTIVE")

    await setArenaStatus(other.id, "SUSPENDED", { actor, reason: "Chargeback investigation" })
    await expect(requirePublicTenantFromRequest(req)).rejects.toMatchObject({ code: "ARENA_UNAVAILABLE" })

    await setArenaStatus(other.id, "ACTIVE", { actor })
    expect((await requirePublicTenantFromRequest(req)).arena.status).toBe("ACTIVE")
  })

  it("records the reason for a suspension", async () => {
    await setArenaStatus(other.id, "SUSPENDED", { actor, reason: "Non-payment" })
    const entry = (await ctx.db.query.auditLogs.findMany({ where: eq(schema.auditLogs.action, "platform.arena.suspended") })).at(-1)!
    expect(JSON.stringify(entry.metadata)).toContain("Non-payment")
    await setArenaStatus(other.id, "ACTIVE", { actor })
  })

  it("will not mark an unfinished arena live behind its owner's back", async () => {
    const pending = await makeArena(ctx.db, "pending-arena", { status: "PENDING_SETUP", onboardingStep: "branding" })
    await expect(setArenaStatus(pending.id, "ACTIVE", { actor })).rejects.toMatchObject({ code: "CONFLICT" })
  })
})

describe("feature flags are per arena", () => {
  beforeAll(async () => {
    await ctx.db.insert(schema.featureFlags).values([
      { key: "custom_domains", description: "Custom domains", defaultEnabled: false },
      { key: "waitlists", description: "Waiting lists", defaultEnabled: true },
    ])
  })

  it("falls back to the platform default until an arena overrides it", async () => {
    expect(await isFeatureEnabled(main.id, "custom_domains")).toBe(false)
    expect(await isFeatureEnabled(main.id, "waitlists")).toBe(true)
  })

  it("turns on for one arena without touching another", async () => {
    await setFeatureFlag(main.id, "custom_domains", true, { actor })
    expect(await isFeatureEnabled(main.id, "custom_domains")).toBe(true)
    expect(await isFeatureEnabled(other.id, "custom_domains")).toBe(false)

    const listed = await listFeatureFlagsForArena(main.id)
    expect(listed.find((f) => f.key === "custom_domains")).toMatchObject({ enabled: true, overridden: true })
    expect(listed.find((f) => f.key === "waitlists")).toMatchObject({ enabled: true, overridden: false })
  })

  it("refuses an arena that does not exist, rather than reporting no flags", async () => {
    await expect(listFeatureFlagsForArena("00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(setFeatureFlag("00000000-0000-0000-0000-000000000000", "waitlists", true, { actor })).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  })

  it("can turn a default-on feature off for one arena", async () => {
    await setFeatureFlag(other.id, "waitlists", false, { actor })
    expect(await isFeatureEnabled(other.id, "waitlists")).toBe(false)
    expect(await isFeatureEnabled(main.id, "waitlists")).toBe(true)
  })
})

describe("impersonation is the only way across the line", () => {
  it("grants nothing before it starts", async () => {
    const me = await principal(platformUserId)
    expect(me.platform?.roleKey).toBe("PLATFORM_OWNER")
    // Platform standing alone reaches no tenant.
    expect(() => authorizeArena(me, other.id, "sessions.view")).toThrowError(/access to this arena/)
  })

  it("insists on a reason", async () => {
    await expect(startImpersonation(platformUserId, other.id, { reason: "why", actor })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    })
  })

  it("grants read-only access to exactly one arena, and records it", async () => {
    await startImpersonation(platformUserId, other.id, { reason: "Investigating a refund complaint", actor })
    const me = (await loadUserPrincipal(platformUserId, "session-1"))!

    const access = me.memberships.find((m) => m.arenaId === other.id)!
    expect(access.impersonated).toBe(true)
    expect(access.roleName).toMatch(/read-only/i)

    // Reading is allowed…
    expect(authorizeArena(me, other.id, "sessions.view", "payments.view", "customers.view").impersonated).toBe(true)
    // …changing anything is not.
    for (const permission of ["sessions.manage", "payments.manage", "staff.invite", "settings.manage", "tickets.validate"] as const) {
      expect(() => authorizeArena(me, other.id, permission), permission).toThrow()
    }

    const entry = (await ctx.db.query.auditLogs.findMany({ where: eq(schema.auditLogs.action, "platform.impersonation.start") })).at(-1)!
    expect(entry.arenaId).toBe(other.id)
    expect(JSON.stringify(entry.metadata)).toContain("refund complaint")
  })

  it("reaches no other arena while it lasts", async () => {
    const me = (await loadUserPrincipal(platformUserId, "session-1"))!
    const third = await makeArena(ctx.db, "arena-c")
    expect(() => authorizeArena(me, third.id, "sessions.view")).toThrowError(/access to this arena/)
  })

  it("expires on its own", async () => {
    const live = (await getActiveImpersonation(platformUserId))!
    await ctx.db
      .update(schema.impersonations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.impersonations.id, live.id))

    expect(await getActiveImpersonation(platformUserId)).toBeNull()
    const me = (await loadUserPrincipal(platformUserId, "session-1"))!
    expect(me.memberships.some((m) => m.arenaId === other.id)).toBe(false)
  })

  it("ends on request, and only one can be open at a time", async () => {
    await startImpersonation(platformUserId, other.id, { reason: "Checking a session grid", actor })
    await startImpersonation(platformUserId, main.id, { reason: "Different arena entirely", actor })

    const open = await ctx.db.query.impersonations.findMany({
      where: and(eq(schema.impersonations.userId, platformUserId), isNull(schema.impersonations.endedAt)),
    })
    expect(open).toHaveLength(1)
    expect(open[0].arenaId).toBe(main.id)

    await endImpersonation(platformUserId, { actor })
    expect(await getActiveImpersonation(platformUserId)).toBeNull()
  })

  it("does not weaken a real membership the operator already has", async () => {
    // The bootstrap account is a genuine ARENA_OWNER of `main`. Impersonating
    // it must not replace that with the read-only grant.
    await startImpersonation(platformUserId, main.id, { reason: "Looking at my own arena", actor })
    const me = (await loadUserPrincipal(platformUserId, "session-1"))!
    const access = me.memberships.find((m) => m.arenaId === main.id)!
    expect(access.impersonated).toBeUndefined()
    expect(authorizeArena(me, main.id, "sessions.manage").roleKey).toBe("ARENA_OWNER")
    await endImpersonation(platformUserId)
  })

  it("is short-lived by construction", () => {
    expect(IMPERSONATION_TTL_MS).toBeLessThanOrEqual(60 * 60 * 1000)
  })
})
