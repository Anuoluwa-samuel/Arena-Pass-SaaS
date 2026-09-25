import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { and, eq } from "drizzle-orm"
import * as schema from "@/server/db/schema"
import {
  authorizeArena,
  authorizePlatform,
  canInArena,
  loadArenaMemberships,
  loadPlatformAccess,
  type AuthorizableUser,
} from "@/server/tenant/authorization"
import { resolveAdminArenaFromRequest } from "@/server/tenant/admin-scope"
import { createStaff, listStaff, removeStaff, updateStaff, setRolePermissions } from "@/server/services/users"
import type { ArenaRoleKey } from "@/lib/domain/constants"
import { createTestDb } from "../helpers/db"

let ctx: Awaited<ReturnType<typeof createTestDb>>

beforeAll(async () => {
  ctx = await createTestDb()
})
afterAll(async () => {
  await ctx.client.close()
})

const actor = (id: string) => ({ type: "user" as const, id, name: "Test" })

async function roleId(key: string) {
  return (await ctx.db.query.roles.findFirst({ where: eq(schema.roles.key, key as never) }))!.id
}

async function makeArena(slug: string) {
  const [organization] = await ctx.db.insert(schema.organizations).values({ slug, name: slug, status: "ACTIVE" }).returning()
  const [arena] = await ctx.db
    .insert(schema.arenas)
    .values({ slug, name: slug, organizationId: organization.id, status: "ACTIVE", onboardingStep: "launched" })
    .returning()
  return arena
}

async function makeUser(email: string, opts: { platformRole?: string } = {}) {
  const [user] = await ctx.db
    .insert(schema.users)
    .values({ email, name: email, passwordHash: "x", platformRoleId: opts.platformRole ? await roleId(opts.platformRole) : null })
    .returning()
  return user
}

async function join(arenaId: string, userId: string, role: ArenaRoleKey, status: schema.ArenaMembership["status"] = "ACTIVE") {
  await ctx.db.insert(schema.arenaMemberships).values({ arenaId, userId, roleId: await roleId(role), status })
}

/** Builds the principal exactly as the session loader does. */
async function principal(userId: string): Promise<AuthorizableUser> {
  const user = (await ctx.db.query.users.findFirst({ where: eq(schema.users.id, userId) }))!
  return {
    id: user.id,
    memberships: await loadArenaMemberships(user.id),
    platform: await loadPlatformAccess(user.platformRoleId),
  }
}

let arenaA: schema.Arena
let arenaB: schema.Arena

beforeAll(async () => {
  arenaA = await makeArena("arena-a")
  arenaB = await makeArena("arena-b")
})

describe("arena authorization", () => {
  it("grants a permission the membership's role holds", async () => {
    const user = await makeUser("owner-a@test")
    await join(arenaA.id, user.id, "ARENA_OWNER")
    const access = authorizeArena(await principal(user.id), arenaA.id, "sessions.manage")
    expect(access.roleKey).toBe("ARENA_OWNER")
    expect(access.arenaId).toBe(arenaA.id)
  })

  it("refuses an arena the user has no membership in", async () => {
    const user = await makeUser("owner-a2@test")
    await join(arenaA.id, user.id, "ARENA_OWNER")
    // Owner of A, asking about B. Owning one arena grants nothing anywhere else.
    const me = await principal(user.id)
    expect(() => authorizeArena(me, arenaB.id, "sessions.view")).toThrowError(/access to this arena/)
  })

  it("refuses a permission the role does not hold, in an arena the user does belong to", async () => {
    const user = await makeUser("staff-a@test")
    await join(arenaA.id, user.id, "STAFF")
    const me = await principal(user.id)
    expect(authorizeArena(me, arenaA.id, "sessions.view").roleKey).toBe("STAFF")
    expect(() => authorizeArena(me, arenaA.id, "payments.manage")).toThrowError(/permission/i)
  })

  it("drops access when the membership is suspended or removed", async () => {
    const user = await makeUser("suspended-a@test")
    await join(arenaA.id, user.id, "MANAGER", "SUSPENDED")
    expect((await principal(user.id)).memberships).toHaveLength(0)

    const removed = await makeUser("removed-a@test")
    await join(arenaA.id, removed.id, "MANAGER", "REMOVED")
    expect((await principal(removed.id)).memberships).toHaveLength(0)

    const invited = await makeUser("invited-a@test")
    await join(arenaA.id, invited.id, "MANAGER", "INVITED")
    expect((await principal(invited.id)).memberships).toHaveLength(0)
  })

  it("lets one person hold different roles in two arenas without either leaking", async () => {
    const user = await makeUser("dual@test")
    await join(arenaA.id, user.id, "ARENA_OWNER")
    await join(arenaB.id, user.id, "TICKET_AGENT")
    const me = await principal(user.id)
    expect(authorizeArena(me, arenaA.id, "settings.manage").roleKey).toBe("ARENA_OWNER")
    expect(authorizeArena(me, arenaB.id, "tickets.view").roleKey).toBe("TICKET_AGENT")
    // The owner role in A does not follow them into B.
    expect(() => authorizeArena(me, arenaB.id, "settings.manage")).toThrow()
  })
})

describe("platform authorization", () => {
  it("is never satisfied by an arena membership", async () => {
    // An arena owner is the most privileged role inside a tenant and still has
    // no platform standing whatsoever.
    const user = await makeUser("owner-only@test")
    await join(arenaA.id, user.id, "ARENA_OWNER")
    const me = await principal(user.id)
    expect(me.platform).toBeNull()
    expect(() => authorizePlatform(me, "platform.arenas.view")).toThrowError(/permission/i)
  })

  it("does not grant arena access to a platform role", async () => {
    // A platform operator with no membership can reach no tenant's data. That
    // is what audited impersonation is for.
    const user = await makeUser("platform-admin@test", { platformRole: "PLATFORM_ADMIN" })
    const me = await principal(user.id)
    expect(me.platform?.roleKey).toBe("PLATFORM_ADMIN")
    expect(() => authorizeArena(me, arenaA.id, "sessions.view")).toThrowError(/access to this arena/)
    expect(canInArena(me, arenaA.id, "sessions.view")).toBe(false)
  })

  it("refuses to check a platform permission against an arena, and vice versa", async () => {
    const user = await makeUser("mixer@test", { platformRole: "PLATFORM_OWNER" })
    await join(arenaA.id, user.id, "ARENA_OWNER")
    const me = await principal(user.id)
    // Both are programming errors: the scopes are not interchangeable.
    expect(() => authorizeArena(me, arenaA.id, "platform.arenas.manage")).toThrowError(/Platform permission checked against an arena/)
    expect(() => authorizePlatform(me, "sessions.view")).toThrowError(/Arena permission checked at platform level/)
  })

  it("never lets an arena role carry a platform permission, even if one is granted by mistake", async () => {
    const user = await makeUser("smuggler@test")
    await join(arenaB.id, user.id, "TICKET_AGENT")
    await ctx.db.insert(schema.rolePermissions).values({ roleId: await roleId("TICKET_AGENT"), permission: "platform.impersonate" })
    const me = await principal(user.id)
    expect(me.memberships[0].permissions).not.toContain("platform.impersonate")
    await ctx.db
      .delete(schema.rolePermissions)
      .where(and(eq(schema.rolePermissions.roleId, await roleId("TICKET_AGENT")), eq(schema.rolePermissions.permission, "platform.impersonate")))
  })
})

describe("which arena an admin request acts on", () => {
  const req = (host: string) => new Request("http://localhost:4000/api/admin/sessions", { headers: { host } })

  it("uses the arena the request is addressed to", async () => {
    const user = await makeUser("dual2@test")
    await join(arenaA.id, user.id, "ARENA_OWNER")
    await join(arenaB.id, user.id, "FINANCE")
    const me = await principal(user.id)
    expect((await resolveAdminArenaFromRequest(me, req("arena-a.localhost"))).roleKey).toBe("ARENA_OWNER")
    expect((await resolveAdminArenaFromRequest(me, req("arena-b.localhost"))).roleKey).toBe("FINANCE")
  })

  it("refuses an address the caller is not a member of, rather than falling back to one they are", async () => {
    // The whole point: on Arena B's address, an Arena A admin gets refused —
    // they are never quietly served Arena A's data instead.
    const user = await makeUser("a-only@test")
    await join(arenaA.id, user.id, "ARENA_OWNER")
    await expect(resolveAdminArenaFromRequest(await principal(user.id), req("arena-b.localhost"))).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
  })

  it("falls back to the caller's only membership when the address names no arena", async () => {
    const user = await makeUser("single@test")
    await join(arenaB.id, user.id, "MANAGER")
    const access = await resolveAdminArenaFromRequest(await principal(user.id), req("unknown-host.example"))
    expect(access.arenaId).toBe(arenaB.id)
  })

  it("asks the caller to choose when they belong to several and the address names none", async () => {
    const user = await makeUser("chooser@test")
    await join(arenaA.id, user.id, "MANAGER")
    await join(arenaB.id, user.id, "MANAGER")
    await expect(resolveAdminArenaFromRequest(await principal(user.id), req("unknown-host.example"))).rejects.toMatchObject({
      code: "ARENA_SELECTION_REQUIRED",
    })
  })

  it("honours a remembered choice only while the membership lasts", async () => {
    const user = await makeUser("cookie@test")
    await join(arenaA.id, user.id, "MANAGER")
    await join(arenaB.id, user.id, "MANAGER")
    const me = await principal(user.id)
    const withCookie = (arenaId: string) =>
      new Request("http://localhost:4000/api/admin/sessions", {
        headers: { host: "unknown-host.example", cookie: `ap_arena=${arenaId}` },
      })
    expect((await resolveAdminArenaFromRequest(me, withCookie(arenaB.id))).arenaId).toBe(arenaB.id)
    // A cookie naming an arena they do not belong to is ignored, not obeyed.
    const other = await makeArena("arena-c")
    await expect(resolveAdminArenaFromRequest(me, withCookie(other.id))).rejects.toMatchObject({
      code: "ARENA_SELECTION_REQUIRED",
    })
  })

  it("refuses a caller with no memberships at all", async () => {
    const user = await makeUser("nobody@test")
    await expect(resolveAdminArenaFromRequest(await principal(user.id), req("unknown-host.example"))).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
  })
})

describe("staff management is scoped to one arena", () => {
  it("lists only this arena's staff", async () => {
    const owner = await makeUser("staff-owner@test")
    await join(arenaA.id, owner.id, "ARENA_OWNER")
    await createStaff(
      { name: "A Manager", email: "a.manager@test", roleKey: "MANAGER", password: "password-1234", isActive: true },
      { arenaId: arenaA.id, actor: actor(owner.id), actorRoleKey: "ARENA_OWNER" }
    )
    const inA = await listStaff(arenaA.id)
    const inB = await listStaff(arenaB.id)
    expect(inA.items.map((s) => s.email)).toContain("a.manager@test")
    expect(inB.items.map((s) => s.email)).not.toContain("a.manager@test")
  })

  it("cannot update or remove a staff member of another arena", async () => {
    const victim = (await ctx.db.query.users.findFirst({ where: eq(schema.users.email, "a.manager@test") }))!
    const ctxB = { arenaId: arenaB.id, actor: actor("00000000-0000-0000-0000-000000000001"), actorRoleKey: "ARENA_OWNER" as const }
    // Knowing the id is not access: from Arena B the row simply does not exist.
    await expect(updateStaff(victim.id, { roleKey: "ARENA_OWNER" }, ctxB)).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(removeStaff(victim.id, ctxB)).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("removes the membership, not the person, and leaves their other arena alone", async () => {
    const owner = await makeUser("two-arena-owner@test")
    await join(arenaA.id, owner.id, "ARENA_OWNER")
    await join(arenaB.id, owner.id, "ARENA_OWNER")
    const worker = await makeUser("worker@test")
    await join(arenaA.id, worker.id, "MANAGER")
    await join(arenaB.id, worker.id, "MANAGER")

    await removeStaff(worker.id, { arenaId: arenaA.id, actor: actor(owner.id), actorRoleKey: "ARENA_OWNER" })

    const stillThere = await ctx.db.query.users.findFirst({ where: eq(schema.users.id, worker.id) })
    expect(stillThere?.deletedAt).toBeNull()
    const memberships = await loadArenaMemberships(worker.id)
    expect(memberships.map((m) => m.arenaId)).toEqual([arenaB.id])
  })

  it("will not let an arena lose its last owner", async () => {
    const solo = await makeArena("arena-solo")
    const owner = await makeUser("solo-owner@test")
    await join(solo.id, owner.id, "ARENA_OWNER")
    const admin = await makeUser("solo-admin@test")
    await join(solo.id, admin.id, "ARENA_ADMIN")
    await expect(
      removeStaff(owner.id, { arenaId: solo.id, actor: actor(admin.id), actorRoleKey: "ARENA_OWNER" })
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it("does not let a non-owner grant the owner role", async () => {
    const admin = await makeUser("promoter@test")
    await join(arenaA.id, admin.id, "ARENA_ADMIN")
    await expect(
      createStaff(
        { name: "Sneaky", email: "sneaky@test", roleKey: "ARENA_OWNER", password: "password-1234", isActive: true },
        { arenaId: arenaA.id, actor: actor(admin.id), actorRoleKey: "ARENA_ADMIN" }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("reuses an existing identity when the same person joins a second arena", async () => {
    const ownerB = await makeUser("owner-b@test")
    await join(arenaB.id, ownerB.id, "ARENA_OWNER")
    const added = await createStaff(
      { name: "A Manager", email: "a.manager@test", roleKey: "TICKET_AGENT", isActive: true },
      { arenaId: arenaB.id, actor: actor(ownerB.id), actorRoleKey: "ARENA_OWNER" }
    )
    const all = await ctx.db.query.users.findMany({ where: eq(schema.users.email, "a.manager@test") })
    expect(all).toHaveLength(1)
    expect(added.role.key).toBe("TICKET_AGENT")
    const memberships = await loadArenaMemberships(all[0].id)
    expect(memberships.map((m) => m.arenaId).sort()).toEqual([arenaA.id, arenaB.id].sort())
  })
})

describe("the role catalogue", () => {
  it("refuses to give an arena role a platform permission", async () => {
    await expect(
      setRolePermissions("MANAGER", ["sessions.view", "platform.impersonate"], { actor: actor("00000000-0000-0000-0000-000000000001") })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" })
  })

  it("refuses to give a platform role an arena permission", async () => {
    await expect(
      setRolePermissions("PLATFORM_SUPPORT", ["sessions.view"], { actor: actor("00000000-0000-0000-0000-000000000001") })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" })
  })

  it("will not change the platform owner", async () => {
    await expect(
      setRolePermissions("PLATFORM_OWNER", [], { actor: actor("00000000-0000-0000-0000-000000000001") })
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })
})
