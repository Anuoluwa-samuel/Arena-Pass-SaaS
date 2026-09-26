import "server-only"
import { and, eq, sql } from "drizzle-orm"
import type { Database } from "./client"
import * as schema from "./schema"
import { DEFAULT_ROLE_PERMISSIONS, ROLE_KEYS, ROLE_LABELS, roleScopeOf } from "@/lib/domain/constants"
import { hashPassword } from "@/server/auth/password"
import { logger } from "@/server/observability/logger"
import { startTrial } from "@/server/services/billing"
import { DEFAULT_CMS_CONTENT } from "@/lib/cms/defaults"

/**
 * Idempotent baseline: system roles with their permissions, one default
 * organization and arena, default CMS pages and a bootstrap platform owner.
 * Runs on every boot and only inserts what is missing, so it is safe in
 * production too. A fresh database must end up in the same shape the tenancy
 * backfill migration produces for an existing one.
 */
export async function ensureBaseline(database: Database) {
  // Roles + permissions
  for (const key of ROLE_KEYS) {
    const [role] = await database
      .insert(schema.roles)
      .values({ key, scope: roleScopeOf(key), name: ROLE_LABELS[key], isSystem: true })
      .onConflictDoNothing({ target: schema.roles.key })
      .returning()
    const roleId = role?.id ?? (await database.query.roles.findFirst({ where: eq(schema.roles.key, key) }))!.id
    // A role renamed by the tenancy migration keeps its old display name until
    // it is refreshed here, so system roles are re-synced on every boot.
    if (!role) {
      await database
        .update(schema.roles)
        .set({ name: ROLE_LABELS[key], scope: roleScopeOf(key), updatedAt: new Date() })
        .where(and(eq(schema.roles.id, roleId), eq(schema.roles.isSystem, true)))
    }
    const existing = await database.query.rolePermissions.findMany({ where: eq(schema.rolePermissions.roleId, roleId) })
    // Seed a role's defaults once. After that the grant is the operator's to
    // manage: re-adding a permission they revoked would be a silent
    // privilege escalation. The platform owner is the exception — the roles
    // UI refuses to edit it, so it always holds the full set and picks up
    // permissions added by a later release.
    const missing =
      existing.length === 0
        ? DEFAULT_ROLE_PERMISSIONS[key]
        : key === "PLATFORM_OWNER"
          ? DEFAULT_ROLE_PERMISSIONS[key].filter((p) => !existing.some((e) => e.permission === p))
          : []
    if (missing.length > 0) {
      await database
        .insert(schema.rolePermissions)
        .values(missing.map((permission) => ({ roleId, permission })))
        .onConflictDoNothing()
    }
  }

  // Default organization
  let organization = await database.query.organizations.findFirst({ where: eq(schema.organizations.slug, "main") })
  if (!organization) {
    ;[organization] = await database
      .insert(schema.organizations)
      .values({ slug: "main", name: process.env.APP_NAME ?? "Game Slots", status: "ACTIVE" })
      .returning()
    logger.info("baseline.organization_created", { organizationId: organization.id })
  }

  // Every organization has a subscription. The backfill in migration 0015 can
  // only reach organizations that existed when it ran, and this one is created
  // afterwards on a fresh install — so the rule has to be enforced here too,
  // or a brand-new deployment is the one shape that breaks it.
  const subscription = await database.query.subscriptions.findFirst({
    where: eq(schema.subscriptions.organizationId, organization.id),
  })
  if (!subscription) {
    await startTrial(organization.id, database)
    logger.info("baseline.subscription_created", { organizationId: organization.id })
  }

  // Default arena. Created ACTIVE and already launched: it is the arena the
  // development seed and the existing deployment run on, not a tenant that
  // still has to walk the onboarding wizard.
  let arena = await database.query.arenas.findFirst({ where: eq(schema.arenas.slug, "main") })
  if (!arena) {
    ;[arena] = await database
      .insert(schema.arenas)
      .values({
        slug: "main",
        name: process.env.APP_NAME ?? "Game Slots",
        city: "Lagos",
        organizationId: organization.id,
        status: "ACTIVE",
        onboardingStep: "launched",
        launchedAt: new Date(),
      })
      .returning()
    logger.info("baseline.arena_created", { arenaId: arena.id })
  } else if (!arena.organizationId) {
    ;[arena] = await database
      .update(schema.arenas)
      .set({ organizationId: organization.id, updatedAt: new Date() })
      .where(eq(schema.arenas.id, arena.id))
      .returning()
  }

  // CMS pages
  for (const [slug, content] of Object.entries(DEFAULT_CMS_CONTENT)) {
    await database
      .insert(schema.cmsPages)
      .values({
        arenaId: arena.id,
        slug: slug as keyof typeof DEFAULT_CMS_CONTENT,
        draft: content,
        published: content,
        publishedAt: new Date(),
      })
      .onConflictDoNothing()
  }

  // Two bootstrap accounts, deliberately two people.
  //
  // The platform is not a tenant. Whoever runs Game Slots has no business
  // reading a venue's customers, and a venue's owner has no business seeing
  // every other venue's takings — so the platform owner gets no arena
  // membership, and the arena owner gets no platform role. The permission
  // scopes were always disjoint; giving one account both was a seeding
  // decision that quietly undid the separation in practice.
  //
  // A platform operator who genuinely needs to look inside an arena does so
  // through impersonation: read-only, time-limited and audited.
  const [{ count }] = await database.select({ count: sql<number>`count(*)::int` }).from(schema.users)
  if (Number(count) === 0) {
    const platformEmail = process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@gameslots.local"
    const platformPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "ChangeMe123!"
    const ownerEmail = process.env.BOOTSTRAP_ARENA_OWNER_EMAIL ?? `owner@${arena.slug}.local`
    const ownerPassword = process.env.BOOTSTRAP_ARENA_OWNER_PASSWORD ?? platformPassword
    // A public deployment must never get the well-known development login.
    if (process.env.NODE_ENV === "production") {
      assertSafeBootstrapAdmin(process.env.BOOTSTRAP_ADMIN_EMAIL, process.env.BOOTSTRAP_ADMIN_PASSWORD)
      assertSafeBootstrapAdmin(process.env.BOOTSTRAP_ARENA_OWNER_EMAIL, process.env.BOOTSTRAP_ARENA_OWNER_PASSWORD)
    }
    const platformOwnerRole = (await database.query.roles.findFirst({ where: eq(schema.roles.key, "PLATFORM_OWNER") }))!
    const arenaOwnerRole = (await database.query.roles.findFirst({ where: eq(schema.roles.key, "ARENA_OWNER") }))!

    await database
      .insert(schema.users)
      .values({
        platformRoleId: platformOwnerRole.id,
        email: platformEmail,
        name: "Platform Owner",
        passwordHash: await hashPassword(platformPassword),
      })
      .returning()

    // The arena needs an owner of its own, or it is an arena nobody can run.
    const [owner] = await database
      .insert(schema.users)
      .values({ email: ownerEmail, name: "Arena Owner", passwordHash: await hashPassword(ownerPassword) })
      .returning()
    await database
      .insert(schema.arenaMemberships)
      .values({ arenaId: arena.id, userId: owner.id, roleId: arenaOwnerRole.id, status: "ACTIVE", acceptedAt: new Date() })
      .onConflictDoNothing()

    logger.warn("baseline.admins_created", {
      platform: platformEmail,
      arenaOwner: ownerEmail,
      note: "Change both passwords immediately",
    })
  }
}

/** Refuses the development defaults or a weak password for the first production admin. */
export function assertSafeBootstrapAdmin(email: string | undefined, password: string | undefined) {
  if (!email || email.toLowerCase() === "admin@gameslots.local") {
    throw new Error("Set BOOTSTRAP_ADMIN_EMAIL to a real address before the first production start")
  }
  if (!password || password === "ChangeMe123!" || password.length < 12) {
    throw new Error("Set BOOTSTRAP_ADMIN_PASSWORD to a strong password (12+ characters, not the development default) before the first production start")
  }
}
