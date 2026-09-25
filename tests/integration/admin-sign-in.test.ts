import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "@/server/db/schema"
import { loadArenaMemberships, type AuthorizableUser } from "@/server/tenant/authorization"
import { resolveAdminArenaFromRequest, SELECTED_ARENA_COOKIE } from "@/server/tenant/admin-scope"
import { createTestDb } from "../helpers/db"
import { getArena, getAdminUser, makeArena } from "../helpers/fixtures"

/**
 * Signing in from the platform's front door.
 *
 * On an arena's hostname the address says which arena the operator meant. On
 * the platform's own hostname — where "I already have one" sends them — it
 * does not, and the answer has to come from their memberships. These cover the
 * three shapes that produces.
 */

let ctx: Awaited<ReturnType<typeof createTestDb>>

beforeAll(async () => {
  ctx = await createTestDb()
})

afterAll(async () => {
  await ctx.client.close()
})

/**
 * The real resolver, driven the way a request drives it: a host that belongs
 * to no arena (the platform's own) and whatever selection cookie the chooser
 * has recorded. `resolveAdminArenaFromRequest` is the shipped code path — the
 * server-component variant differs only in where it reads those two from.
 */
async function resolveWithoutHost(userId: string, selectedArenaId: string | null) {
  const user: AuthorizableUser = { id: userId, memberships: await loadArenaMemberships(userId), platform: null }
  const headers = new Headers({ host: "gameslots.test" })
  if (selectedArenaId) headers.set("cookie", `${SELECTED_ARENA_COOKIE}=${selectedArenaId}`)
  return resolveAdminArenaFromRequest(user, new Request("http://gameslots.test/admin", { headers }))
}

describe("landing somewhere sensible after signing in at the apex", () => {
  it("goes straight in when the operator runs exactly one arena", async () => {
    const user = await getAdminUser(ctx.db)
    const arena = await getArena(ctx.db)
    const access = await resolveWithoutHost(user.id, null)
    expect(access.arenaId).toBe(arena.id)
  })

  it("asks which one when they run several", async () => {
    const user = await getAdminUser(ctx.db)
    const second = await makeArena(ctx.db, "second-arena")
    const ownerRole = (await ctx.db.query.roles.findFirst({ where: eq(schema.roles.key, "ARENA_OWNER") }))!
    await ctx.db
      .insert(schema.arenaMemberships)
      .values({ arenaId: second.id, userId: user.id, roleId: ownerRole.id, status: "ACTIVE", acceptedAt: new Date() })

    await expect(resolveWithoutHost(user.id, null)).rejects.toMatchObject({ code: "ARENA_SELECTION_REQUIRED" })
  })

  it("honours the arena they chose, which is what the chooser records", async () => {
    // The chooser posts to /api/admin/arena/select, which validates membership
    // and sets the cookie this reads. Before that endpoint was wired up the
    // buttons linked to `?arena=<slug>`, a parameter nothing read — so the
    // screen offered a choice it then ignored.
    const user = await getAdminUser(ctx.db)
    const second = (await ctx.db.query.arenas.findFirst({ where: eq(schema.arenas.slug, "second-arena") }))!
    const access = await resolveWithoutHost(user.id, second.id)
    expect(access.arenaId).toBe(second.id)
  })

  it("refuses a selection they are not a member of, rather than honouring the cookie", async () => {
    const user = await getAdminUser(ctx.db)
    const stranger = await makeArena(ctx.db, "not-theirs")
    // A tampered cookie naming someone else's arena falls through to the
    // ordinary rules; it never grants access.
    await expect(resolveWithoutHost(user.id, stranger.id)).rejects.toMatchObject({ code: "ARENA_SELECTION_REQUIRED" })
  })

  it("has nothing to offer an account that belongs to no arena", async () => {
    const [orphan] = await ctx.db
      .insert(schema.users)
      .values({ name: "No Arenas", email: "orphan@fixture.local", passwordHash: "x" })
      .returning()
    await expect(resolveWithoutHost(orphan.id, null)).rejects.toMatchObject({ code: "FORBIDDEN" })
  })
})
