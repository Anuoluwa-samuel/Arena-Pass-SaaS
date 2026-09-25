import "server-only"
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm"
import { db, schema } from "@/server/db"
import { AppError, notFound } from "@/server/http/errors"
import { logger } from "@/server/observability/logger"
import { FEATURE_FLAGS, type FeatureFlag } from "@/lib/domain/constants"
import { recordAudit, type AuditActor } from "./audit"

/**
 * The platform's own view of the estate.
 *
 * Everything here is deliberately *not* arena-scoped — that is the whole
 * point of a platform surface — so every function in this file is reachable
 * only through `platformRoute` / `requirePlatformPermission`, which a tenant
 * role can never satisfy.
 */

export async function getPlatformOverview() {
  const database = await db()
  const [counts] = await database.execute(sql`
    select
      (select count(*)::int from organizations where deleted_at is null) as organizations,
      (select count(*)::int from arenas where deleted_at is null) as arenas,
      (select count(*)::int from arenas where status = 'ACTIVE' and deleted_at is null) as live_arenas,
      (select count(*)::int from arenas where status = 'PENDING_SETUP' and deleted_at is null) as setting_up,
      (select count(*)::int from arenas where status = 'SUSPENDED' and deleted_at is null) as suspended,
      (select count(*)::int from users where deleted_at is null) as operators,
      (select count(*)::int from customers where deleted_at is null) as customers,
      (select count(*)::int from sessions where deleted_at is null) as sessions,
      (select count(*)::int from tickets) as tickets
  `).then((r) => (r as unknown as { rows: Record<string, number>[] }).rows)
  return counts
}

export interface PlatformArenaRow {
  id: string
  slug: string
  name: string
  status: schema.Arena["status"]
  createdAt: Date
  launchedAt: Date | null
  organizationName: string
  members: number
  sessions: number
}

export async function listPlatformArenas(opts: { q?: string; status?: string } = {}): Promise<PlatformArenaRow[]> {
  const database = await db()
  const where = [isNull(schema.arenas.deletedAt)]
  if (opts.status && opts.status !== "all") where.push(eq(schema.arenas.status, opts.status as schema.Arena["status"]))
  if (opts.q) where.push(sql`(${schema.arenas.name} ilike ${"%" + opts.q + "%"} or ${schema.arenas.slug} ilike ${"%" + opts.q + "%"})`)

  const rows = await database
    .select({
      id: schema.arenas.id,
      slug: schema.arenas.slug,
      name: schema.arenas.name,
      status: schema.arenas.status,
      createdAt: schema.arenas.createdAt,
      launchedAt: schema.arenas.launchedAt,
      organizationName: schema.organizations.name,
      members: sql<number>`(select count(*)::int from ${schema.arenaMemberships} m where m.arena_id = ${schema.arenas.id} and m.status = 'ACTIVE')`,
      sessions: sql<number>`(select count(*)::int from ${schema.sessions} s where s.arena_id = ${schema.arenas.id} and s.deleted_at is null)`,
    })
    .from(schema.arenas)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.arenas.organizationId))
    .where(and(...where))
    .orderBy(desc(schema.arenas.createdAt))
  return rows
}

/**
 * Suspends or restores an arena. A suspended arena's storefront stops serving
 * customers immediately; its operators keep admin access so they can fix
 * whatever caused it.
 */
export async function setArenaStatus(
  arenaId: string,
  status: Extract<schema.Arena["status"], "ACTIVE" | "SUSPENDED" | "ARCHIVED">,
  ctx: { actor: AuditActor; reason?: string }
) {
  const database = await db()
  const arena = await database.query.arenas.findFirst({ where: eq(schema.arenas.id, arenaId) })
  if (!arena) throw notFound("Arena")
  if (arena.status === "PENDING_SETUP" && status === "ACTIVE") {
    throw new AppError("CONFLICT", "This arena has not finished setting up; its owner launches it")
  }
  const [updated] = await database
    .update(schema.arenas)
    .set({ status, updatedAt: new Date() })
    .where(eq(schema.arenas.id, arenaId))
    .returning()
  await recordAudit(ctx.actor, {
    action: `platform.arena.${status.toLowerCase()}`,
    entityType: "arena",
    entityId: arenaId,
    arenaId,
    description: `Set ${arena.name} to ${status.toLowerCase()}`,
    metadata: { from: arena.status, to: status, reason: ctx.reason ?? null },
  })
  return updated
}

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

/**
 * Whether a capability is on for one arena. Read on the server for anything
 * that matters: a hidden button is not a feature gate.
 */
export async function isFeatureEnabled(arenaId: string, flag: FeatureFlag): Promise<boolean> {
  const database = await db()
  const override = await database.query.arenaFeatureFlags.findFirst({
    where: and(eq(schema.arenaFeatureFlags.arenaId, arenaId), eq(schema.arenaFeatureFlags.flagKey, flag)),
  })
  if (override) return override.enabled
  const definition = await database.query.featureFlags.findFirst({ where: eq(schema.featureFlags.key, flag) })
  return definition?.defaultEnabled ?? false
}

export async function listFeatureFlagsForArena(arenaId: string) {
  const database = await db()
  // An unknown arena is not an empty flag list; say so rather than implying
  // the arena exists with nothing switched on.
  const arena = await database.query.arenas.findFirst({ where: eq(schema.arenas.id, arenaId) })
  if (!arena) throw notFound("Arena")
  const [definitions, overrides] = await Promise.all([
    database.query.featureFlags.findMany(),
    database.query.arenaFeatureFlags.findMany({ where: eq(schema.arenaFeatureFlags.arenaId, arenaId) }),
  ])
  return definitions.map((definition) => {
    const override = overrides.find((o) => o.flagKey === definition.key)
    return {
      key: definition.key as FeatureFlag,
      description: definition.description,
      enabled: override ? override.enabled : definition.defaultEnabled,
      overridden: !!override,
    }
  })
}

export async function setFeatureFlag(arenaId: string, flag: FeatureFlag, enabled: boolean, ctx: { actor: AuditActor }) {
  if (!FEATURE_FLAGS.includes(flag)) throw new AppError("VALIDATION_ERROR", `Unknown feature: ${flag}`)
  const database = await db()
  const arena = await database.query.arenas.findFirst({ where: eq(schema.arenas.id, arenaId) })
  if (!arena) throw notFound("Arena")
  await database
    .insert(schema.arenaFeatureFlags)
    .values({ arenaId, flagKey: flag, enabled })
    .onConflictDoUpdate({ target: [schema.arenaFeatureFlags.arenaId, schema.arenaFeatureFlags.flagKey], set: { enabled, updatedAt: new Date() } })
  await recordAudit(ctx.actor, {
    action: "platform.feature.set",
    entityType: "arena",
    entityId: arenaId,
    arenaId,
    description: `${enabled ? "Enabled" : "Disabled"} ${flag}`,
    metadata: { flag, enabled },
  })
}

// ---------------------------------------------------------------------------
// Impersonation
// ---------------------------------------------------------------------------

/** Short on purpose: long enough to look at something, not to work in. */
export const IMPERSONATION_TTL_MS = 30 * 60 * 1000

export async function startImpersonation(
  userId: string,
  arenaId: string,
  ctx: { reason: string; actor: AuditActor }
) {
  const reason = ctx.reason.trim()
  if (reason.length < 5) throw new AppError("VALIDATION_ERROR", "Say why you need to look inside this arena")
  const database = await db()
  const arena = await database.query.arenas.findFirst({ where: eq(schema.arenas.id, arenaId) })
  if (!arena) throw notFound("Arena")

  // One at a time: two open sessions would make the audit trail ambiguous.
  await endImpersonation(userId)
  const [row] = await database
    .insert(schema.impersonations)
    .values({ userId, arenaId, reason, expiresAt: new Date(Date.now() + IMPERSONATION_TTL_MS), ipAddress: ctx.actor.ip ?? null })
    .returning()

  logger.warn("platform.impersonation_started", { userId, arenaId, impersonationId: row.id })
  await recordAudit(ctx.actor, {
    action: "platform.impersonation.start",
    entityType: "arena",
    entityId: arenaId,
    arenaId,
    description: `Started looking inside ${arena.name}`,
    metadata: { reason, expiresAt: row.expiresAt.toISOString() },
  })
  return row
}

export async function endImpersonation(userId: string, ctx?: { actor: AuditActor }) {
  const database = await db()
  const ended = await database
    .update(schema.impersonations)
    .set({ endedAt: new Date() })
    .where(and(eq(schema.impersonations.userId, userId), isNull(schema.impersonations.endedAt)))
    .returning()
  if (ended.length > 0 && ctx) {
    await recordAudit(ctx.actor, {
      action: "platform.impersonation.end",
      entityType: "arena",
      entityId: ended[0].arenaId,
      arenaId: ended[0].arenaId,
      description: "Stopped looking inside this arena",
    })
  }
  return ended[0] ?? null
}

/** The caller's live impersonation, if any. Expiry is a query condition, not a sweep. */
export async function getActiveImpersonation(userId: string) {
  const database = await db()
  return (
    (await database.query.impersonations.findFirst({
      where: and(
        eq(schema.impersonations.userId, userId),
        isNull(schema.impersonations.endedAt),
        gt(schema.impersonations.expiresAt, new Date())
      ),
      orderBy: [desc(schema.impersonations.startedAt)],
    })) ?? null
  )
}

export async function listImpersonations(arenaId?: string) {
  const database = await db()
  return database
    .select({
      impersonation: schema.impersonations,
      user: { id: schema.users.id, name: schema.users.name, email: schema.users.email },
      arena: { id: schema.arenas.id, name: schema.arenas.name, slug: schema.arenas.slug },
    })
    .from(schema.impersonations)
    .innerJoin(schema.users, eq(schema.users.id, schema.impersonations.userId))
    .innerJoin(schema.arenas, eq(schema.arenas.id, schema.impersonations.arenaId))
    .where(arenaId ? eq(schema.impersonations.arenaId, arenaId) : ne(schema.impersonations.id, sql`'00000000-0000-0000-0000-000000000000'::uuid`))
    .orderBy(desc(schema.impersonations.startedAt))
    .limit(100)
}
