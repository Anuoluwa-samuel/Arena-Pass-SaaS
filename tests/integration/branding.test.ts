import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "@/server/db/schema"
import { getBranding, updateBranding, brandingSchema } from "@/server/services/branding"
import { createTestDb } from "../helpers/db"
import { getArena, getAdminUser, makeArena, testActor } from "../helpers/fixtures"

/**
 * Branding is the one thing every tenant is expected to change, so it is also
 * the one an operator is most likely to reach for on the wrong arena.
 */

let ctx: Awaited<ReturnType<typeof createTestDb>>
let a: schema.Arena
let b: schema.Arena

let actor: typeof testActor

beforeAll(async () => {
  ctx = await createTestDb()
  a = await getArena(ctx.db)
  b = await makeArena(ctx.db, "arena-b")
  actor = { ...testActor, id: (await getAdminUser(ctx.db)).id }
})

afterAll(async () => {
  await ctx.client.close()
})

describe("an arena's own colours", () => {
  it("starts on the platform palette rather than a colour nobody picked", async () => {
    const branding = await getBranding(b.id)
    expect(branding.primaryColor).toBeNull()
    expect(branding.accentColor).toBeNull()
    expect(branding.resolved.primary).toBeNull()
  })

  it("stores what was chosen and reports what each theme will render", async () => {
    const saved = await updateBranding(a.id, { primaryColor: "#22C55E", accentColor: "#0ea5e9" }, { actor })
    expect(saved.primaryColor).toBe("#22c55e")
    expect(saved.resolved.primary!.chosen).toBe("#22c55e")
    // The two themes cannot share a value; that is the whole reason both exist.
    expect(saved.resolved.primary!.light).not.toBe(saved.resolved.primary!.dark)
  })

  it("clears back to the platform palette with an explicit null", async () => {
    await updateBranding(a.id, { primaryColor: "#22c55e" }, { actor })
    const cleared = await updateBranding(a.id, { primaryColor: null }, { actor })
    expect(cleared.primaryColor).toBeNull()
  })

  it("leaves a colour alone when its key is absent, rather than wiping it", async () => {
    await updateBranding(a.id, { primaryColor: "#b91c1c", accentColor: "#be123c" }, { actor })
    const after = await updateBranding(a.id, { accentColor: "#9333ea" }, { actor })
    expect(after.primaryColor).toBe("#b91c1c")
    expect(after.accentColor).toBe("#9333ea")
  })

  it("refuses anything that is not a hex colour", () => {
    for (const bad of ["red", "rgb(0,0,0)", "#12345", "javascript:alert(1)", "#fff; --x: url(evil)"]) {
      expect(brandingSchema.partial().safeParse({ primaryColor: bad }).success, bad).toBe(false)
    }
  })
})

describe("branding cannot cross arenas", () => {
  it("writing to another arena needs that arena's id, which the route never takes from the caller", async () => {
    // The service is given an arena id by `adminRoute`, resolved from the
    // operator's membership. This asserts the consequence that matters: a
    // write to A cannot touch B.
    await updateBranding(a.id, { primaryColor: "#15803d" }, { actor })
    const untouched = await getBranding(b.id)
    expect(untouched.primaryColor).toBeNull()
  })

  it("is a not-found for an arena that does not exist", async () => {
    await expect(getBranding("00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("is a not-found for a soft-deleted arena", async () => {
    const database = ctx.db
    await database.update(schema.arenas).set({ deletedAt: new Date() }).where(eq(schema.arenas.id, b.id))
    await expect(getBranding(b.id)).rejects.toMatchObject({ code: "NOT_FOUND" })
    await database.update(schema.arenas).set({ deletedAt: null }).where(eq(schema.arenas.id, b.id))
  })

  it("records the change against the arena it happened in", async () => {
    await updateBranding(a.id, { primaryColor: "#6d28d9" }, { actor })
    const entries = await ctx.db.query.auditLogs.findMany({ where: eq(schema.auditLogs.action, "arena.branding_update") })
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((e) => e.arenaId === a.id)).toBe(true)
  })
})
