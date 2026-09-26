import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { and, eq, isNotNull } from "drizzle-orm"
import * as schema from "@/server/db/schema"
import { ARENA_ROLE_KEYS, PLATFORM_ROLE_KEYS, ROLE_KEYS } from "@/lib/domain/constants"
import { createTestDb } from "../helpers/db"
import { expectDbError } from "../helpers/errors"

let ctx: Awaited<ReturnType<typeof createTestDb>>

beforeAll(async () => {
  ctx = await createTestDb()
})
afterAll(async () => {
  await ctx.client.close()
})

async function roleByKey(key: string) {
  return (await ctx.db.query.roles.findFirst({ where: eq(schema.roles.key, key as never) }))!
}

/** A second tenant with its own organization, owner and membership. */
async function createTenant(slug: string) {
  const [organization] = await ctx.db.insert(schema.organizations).values({ slug, name: slug, status: "ACTIVE" }).returning()
  const [arena] = await ctx.db
    .insert(schema.arenas)
    .values({ slug, name: slug, organizationId: organization.id, status: "ACTIVE", onboardingStep: "launched" })
    .returning()
  const [user] = await ctx.db
    .insert(schema.users)
    .values({ email: `owner@${slug}.test`, name: `${slug} owner`, passwordHash: "x" })
    .returning()
  const [membership] = await ctx.db
    .insert(schema.arenaMemberships)
    .values({ arenaId: arena.id, userId: user.id, roleId: (await roleByKey("ARENA_OWNER")).id, status: "ACTIVE" })
    .returning()
  return { organization, arena, user, membership }
}

describe("baseline tenancy shape", () => {
  it("seeds every role with the right scope", async () => {
    const roles = await ctx.db.query.roles.findMany()
    expect(roles.map((r) => r.key).sort()).toEqual([...ROLE_KEYS].sort())
    for (const role of roles) {
      const expected = (PLATFORM_ROLE_KEYS as readonly string[]).includes(role.key) ? "PLATFORM" : "ARENA"
      expect(role.scope, `${role.key} scope`).toBe(expected)
    }
    expect(roles.filter((r) => r.scope === "ARENA").map((r) => r.key).sort()).toEqual([...ARENA_ROLE_KEYS].sort())
  })

  it("creates the default arena under an organization, active and launched", async () => {
    const arena = (await ctx.db.query.arenas.findFirst({ where: eq(schema.arenas.slug, "main") }))!
    expect(arena.organizationId).toBeTruthy()
    expect(arena.status).toBe("ACTIVE")
    expect(arena.onboardingStep).toBe("launched")
    const organization = (await ctx.db.query.organizations.findFirst({ where: eq(schema.organizations.id, arena.organizationId!) }))!
    expect(organization.status).toBe("ACTIVE")
  })

  it("bootstraps the platform operator and the arena operator as two people", async () => {
    // One account holding both a platform role and an arena membership is what
    // the separation is *for*: whoever runs the platform has no business in a
    // venue's data, and a venue's owner has no business across every venue.
    const platformUser = (await ctx.db.query.users.findFirst({
      where: isNotNull(schema.users.platformRoleId),
    }))!
    const platformRole = (await ctx.db.query.roles.findFirst({ where: eq(schema.roles.id, platformUser.platformRoleId!) }))!
    expect(platformRole.key).toBe("PLATFORM_OWNER")
    expect(platformRole.scope).toBe("PLATFORM")
    expect(
      await ctx.db.query.arenaMemberships.findFirst({ where: eq(schema.arenaMemberships.userId, platformUser.id) })
    ).toBeUndefined()

    // The arena has an owner of its own, who holds no platform role.
    const membership = (await ctx.db.query.arenaMemberships.findFirst())!
    const membershipRole = (await ctx.db.query.roles.findFirst({ where: eq(schema.roles.id, membership.roleId) }))!
    expect(membershipRole.key).toBe("ARENA_OWNER")
    expect(membershipRole.scope).toBe("ARENA")
    expect(membership.status).toBe("ACTIVE")
    const arenaUser = (await ctx.db.query.users.findFirst({ where: eq(schema.users.id, membership.userId) }))!
    expect(arenaUser.platformRoleId).toBeNull()
    expect(arenaUser.id).not.toBe(platformUser.id)
  })
})

describe("tenancy constraints", () => {
  it("rejects a role key outside the vocabulary", async () => {
    await expectDbError(
      ctx.db.insert(schema.roles).values({ key: "ROOT" as never, name: "Root", scope: "PLATFORM" }),
      /roles_key_known/
    )
  })

  it("allows one membership per user per arena and refuses a duplicate", async () => {
    const { arena, user } = await createTenant("lekki")
    await expectDbError(
      ctx.db.insert(schema.arenaMemberships).values({ arenaId: arena.id, userId: user.id, roleId: (await roleByKey("MANAGER")).id }),
      /arena_memberships_arena_user_idx/
    )
  })

  it("lets one user hold memberships in two arenas with different roles", async () => {
    const lekki = (await ctx.db.query.arenas.findFirst({ where: eq(schema.arenas.slug, "lekki") }))!
    const ikeja = await createTenant("ikeja")
    const lekkiOwner = (await ctx.db.query.users.findFirst({ where: eq(schema.users.email, "owner@lekki.test") }))!

    await ctx.db
      .insert(schema.arenaMemberships)
      .values({ arenaId: ikeja.arena.id, userId: lekkiOwner.id, roleId: (await roleByKey("FINANCE")).id, status: "ACTIVE" })

    const memberships = await ctx.db.query.arenaMemberships.findMany({ where: eq(schema.arenaMemberships.userId, lekkiOwner.id) })
    expect(memberships).toHaveLength(2)
    expect(memberships.map((m) => m.arenaId).sort()).toEqual([lekki.id, ikeja.arena.id].sort())
  })

  it("does not give an arena owner any membership in another arena", async () => {
    const ikejaOwner = (await ctx.db.query.users.findFirst({ where: eq(schema.users.email, "owner@ikeja.test") }))!
    const lekki = (await ctx.db.query.arenas.findFirst({ where: eq(schema.arenas.slug, "lekki") }))!
    const crossing = await ctx.db.query.arenaMemberships.findFirst({
      where: and(eq(schema.arenaMemberships.userId, ikejaOwner.id), eq(schema.arenaMemberships.arenaId, lekki.id)),
    })
    expect(crossing).toBeUndefined()
  })

  it("claims a hostname exactly once, regardless of case", async () => {
    const lekki = (await ctx.db.query.arenas.findFirst({ where: eq(schema.arenas.slug, "lekki") }))!
    const ikeja = (await ctx.db.query.arenas.findFirst({ where: eq(schema.arenas.slug, "ikeja") }))!
    await ctx.db.insert(schema.arenaDomains).values({ arenaId: lekki.id, hostname: "book.lekkiarena.com", status: "VERIFIED" })
    await expectDbError(
      ctx.db.insert(schema.arenaDomains).values({ arenaId: ikeja.id, hostname: "BOOK.LekkiArena.com" }),
      /arena_domains_hostname_idx/
    )
  })

  it("holds one payment account per provider per arena", async () => {
    const lekki = (await ctx.db.query.arenas.findFirst({ where: eq(schema.arenas.slug, "lekki") }))!
    const ikeja = (await ctx.db.query.arenas.findFirst({ where: eq(schema.arenas.slug, "ikeja") }))!
    await ctx.db.insert(schema.arenaPaymentAccounts).values({ arenaId: lekki.id, provider: "paystack", status: "ACTIVE" })
    // A different arena may use the same provider — with its own account.
    await ctx.db.insert(schema.arenaPaymentAccounts).values({ arenaId: ikeja.id, provider: "paystack", status: "ACTIVE" })
    await expectDbError(
      ctx.db.insert(schema.arenaPaymentAccounts).values({ arenaId: lekki.id, provider: "paystack" }),
      /arena_payment_accounts_arena_provider_idx/
    )
  })

  it("keeps arena slugs globally unique because they are subdomains", async () => {
    const [org] = await ctx.db.insert(schema.organizations).values({ slug: "impostor", name: "Impostor", status: "ACTIVE" }).returning()
    await expectDbError(
      ctx.db.insert(schema.arenas).values({ slug: "lekki", name: "Impostor", organizationId: org.id }),
      /arenas_slug_unique|slug/
    )
  })
})
