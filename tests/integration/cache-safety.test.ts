import { describe, it, expect, beforeAll, afterAll } from "vitest"
import * as schema from "@/server/db/schema"
import { createTestDb } from "../helpers/db"
import { getArena, makeArena } from "../helpers/fixtures"

/**
 * What a shared cache is allowed to keep.
 *
 * A tenant-specific response served to the wrong host is the worst kind of
 * leak, because nothing in the application is involved: the request never
 * reaches it. These assertions run against the real route handlers.
 */

let ctx: Awaited<ReturnType<typeof createTestDb>>
let arena: schema.Arena

beforeAll(async () => {
  ctx = await createTestDb()
  arena = await getArena(ctx.db)
  await makeArena(ctx.db, "arena-b")
})
afterAll(async () => {
  await ctx.client.close()
})

const request = (path: string, host = `${arena.slug}.localhost`) =>
  new Request(`http://localhost:4000${path}`, { headers: { host } })

describe("responses a shared cache may keep", () => {
  it("names every tenant-selecting input in Vary", async () => {
    // The response depends on which arena the request resolved to. A cache
    // that keys on the URL alone would otherwise serve one arena's content
    // on another's address.
    for (const [path, mod] of [
      ["/api/cms/public", await import("@/app/api/cms/public/route")],
      ["/api/sessions", await import("@/app/api/sessions/route")],
    ] as const) {
      const res = await mod.GET(request(path), { params: Promise.resolve({}) } as never)
      const vary = res.headers.get("Vary") ?? ""
      expect(res.headers.get("Cache-Control"), path).toContain("public")
      expect(vary.toLowerCase(), path).toContain("host")
      expect(vary.toLowerCase(), path).toContain("x-arena-slug")
    }
  })
})

describe("responses a shared cache may not keep", () => {
  it("marks a customer's own data as private and unstorable", async () => {
    const mod = await import("@/app/api/me/profile/route")
    // Unauthenticated is enough: the header must be a property of the route,
    // not something earned by signing in.
    const res = await mod.GET(request("/api/me/profile"), { params: Promise.resolve({}) } as never)
    expect(res.headers.get("Cache-Control")).toContain("no-store")
  })

  it("never lets a booking response be stored, found or not", async () => {
    const bookings = await import("@/app/api/bookings/[id]/route")
    const res = await bookings.GET(request("/api/bookings/x"), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    } as never)
    expect(res.headers.get("Cache-Control")).toContain("no-store")
  })

  it("does not cache a refusal", async () => {
    // A denial depends on who asked and from where; a stored 403 would be
    // served back to someone who might now be allowed.
    const mod = await import("@/app/api/cms/public/route")
    const res = await mod.GET(request("/api/cms/public", "evil.example"), { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(404)
    expect(res.headers.get("Cache-Control")).toContain("no-store")
  })

  it("serves an unrecognised host nothing at all, cacheable or otherwise", async () => {
    const mod = await import("@/app/api/cms/public/route")
    const res = await mod.GET(request("/api/cms/public", "evil.example"), { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe("ARENA_NOT_FOUND")
  })

  it("gives two arenas different bodies on the same URL", async () => {
    const mod = await import("@/app/api/cms/public/route")
    const mine = await mod.GET(request("/api/cms/public", "main.localhost"), { params: Promise.resolve({}) } as never)
    const theirs = await mod.GET(request("/api/cms/public", "arena-b.localhost"), { params: Promise.resolve({}) } as never)
    const a = (await mine.json()) as { data: { arena: { id: string } } }
    const b = (await theirs.json()) as { data: { arena: { id: string } } }
    // Same path, same query, different tenant — which is exactly why the
    // cache key cannot be the URL alone.
    expect(a.data.arena.id).not.toBe(b.data.arena.id)
  })
})
