import "server-only"
import { and, count, eq, gte, isNull, sql } from "drizzle-orm"
import { db, schema, type DbExecutor } from "@/server/db"
import { AppError, notFound } from "@/server/http/errors"
import { logger } from "@/server/observability/logger"
import { recordAudit, type AuditActor } from "@/server/services/audit"
import {
  LIMIT_FOR,
  METRIC_LABEL,
  canWriteAsAdmin,
  isLive,
  periodStartFor,
  trialDaysLeft,
  type PlanLimits,
} from "@/lib/domain/billing"
import type { SubscriptionStatus, UsageMetric } from "@/lib/domain/constants"

/**
 * What an organization owes Game Slots, and what its plan lets it do.
 *
 * Scoped by `organization_id`, one level above `arena_id`. That is the whole
 * point of the separation: an arena's takings are the arena's, and the
 * subscription is the organization's. The two share no table and no status
 * vocabulary — see docs/BILLING.md.
 *
 * Nothing here charges anyone. Money arrives in a later phase; this phase
 * makes the state real, visible and enforced.
 */

export const TRIAL_DAYS = 30
export const DEFAULT_PLAN_KEY = "starter"

export interface BillingSummary {
  plan: {
    key: string
    name: string
    description: string | null
    priceMinor: number
    currency: string
    interval: string
    limits: PlanLimits
  }
  subscription: {
    status: SubscriptionStatus
    currentPeriodStart: Date
    currentPeriodEnd: Date
    trialEndsAt: Date | null
    trialDaysLeft: number | null
    cancelledAt: Date | null
  }
  usage: { metric: UsageMetric; label: string; used: number; limit: number | null }[]
  /** False once a PAST_DUE grace period has run out. Never gates the storefront. */
  canWriteAsAdmin: boolean
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export async function listPlans(opts: { includePrivate?: boolean } = {}) {
  const database = await db()
  const rows = await database.query.plans.findMany({ orderBy: [schema.plans.sortOrder, schema.plans.priceMinor] })
  return opts.includePrivate ? rows : rows.filter((p) => p.isPublic)
}

export async function getPlanByKey(key: string, executor?: DbExecutor) {
  const database = executor ?? (await db())
  return database.query.plans.findFirst({ where: eq(schema.plans.key, key) })
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/**
 * Opens a trial for a new organization.
 *
 * Called inside `registerArena`'s transaction, so an organization can never
 * exist without a subscription — a nullable relationship here would mean every
 * later read has to decide what "no subscription" means, and they would not
 * all decide the same thing.
 */
export async function startTrial(
  organizationId: string,
  executor: DbExecutor,
  opts: { planKey?: string; now?: Date } = {}
) {
  const plan = await getPlanByKey(opts.planKey ?? DEFAULT_PLAN_KEY, executor)
  if (!plan) {
    // A deployment with no plan catalogue is a deployment that cannot onboard.
    throw new AppError("INTERNAL_ERROR", `No plan '${opts.planKey ?? DEFAULT_PLAN_KEY}' to start a trial on`)
  }
  const now = opts.now ?? new Date()
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 86_400_000)

  const [subscription] = await executor
    .insert(schema.subscriptions)
    .values({
      organizationId,
      planId: plan.id,
      status: "TRIALING",
      currentPeriodStart: now,
      currentPeriodEnd: trialEndsAt,
      trialEndsAt,
    })
    .returning()

  await executor.insert(schema.subscriptionEvents).values({
    subscriptionId: subscription.id,
    organizationId,
    type: "trial_started",
    toStatus: "TRIALING",
    metadata: { planKey: plan.key, trialDays: TRIAL_DAYS },
  })

  return subscription
}

/** The organization that owns an arena. */
async function organizationIdForArena(arenaId: string): Promise<string> {
  const database = await db()
  const arena = await database.query.arenas.findFirst({ where: eq(schema.arenas.id, arenaId) })
  if (!arena || arena.deletedAt) throw notFound("Arena")
  if (!arena.organizationId) throw new AppError("INTERNAL_ERROR", "Arena has no organization")
  return arena.organizationId
}

export async function getSubscription(organizationId: string) {
  const database = await db()
  return database.query.subscriptions.findFirst({ where: eq(schema.subscriptions.organizationId, organizationId) })
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

/**
 * What an organization is using right now.
 *
 * Counted from the tables themselves rather than read from `usage_records`,
 * because a counter that drifts is worse than no counter: it either blocks an
 * operator who has room or lets one through who does not. `usage_records` is
 * the historical ledger for billing; this is the live truth for limits.
 */
export async function currentUsage(organizationId: string, metric: UsageMetric, at = new Date()): Promise<number> {
  const database = await db()
  const periodStart = periodStartFor(at)

  const arenaIds = database
    .select({ id: schema.arenas.id })
    .from(schema.arenas)
    .where(and(eq(schema.arenas.organizationId, organizationId), isNull(schema.arenas.deletedAt)))

  switch (metric) {
    case "ARENAS": {
      const [row] = await database
        .select({ n: count() })
        .from(schema.arenas)
        .where(
          and(
            eq(schema.arenas.organizationId, organizationId),
            isNull(schema.arenas.deletedAt),
            sql`${schema.arenas.status} <> 'ARCHIVED'`
          )
        )
      return Number(row?.n ?? 0)
    }
    case "SESSIONS": {
      const [row] = await database
        .select({ n: count() })
        .from(schema.sessions)
        .where(and(sql`${schema.sessions.arenaId} in ${arenaIds}`, gte(schema.sessions.createdAt, periodStart)))
      return Number(row?.n ?? 0)
    }
    case "STAFF": {
      // Distinct people, not memberships: one person working across two of the
      // organization's arenas is one member of staff being paid for once.
      const [row] = await database
        .select({ n: sql<number>`count(distinct ${schema.arenaMemberships.userId})` })
        .from(schema.arenaMemberships)
        .where(
          and(
            sql`${schema.arenaMemberships.arenaId} in ${arenaIds}`,
            eq(schema.arenaMemberships.status, "ACTIVE")
          )
        )
      return Number(row?.n ?? 0)
    }
    case "TICKETS": {
      const [row] = await database
        .select({ n: count() })
        .from(schema.tickets)
        .where(and(sql`${schema.tickets.arenaId} in ${arenaIds}`, gte(schema.tickets.createdAt, periodStart)))
      return Number(row?.n ?? 0)
    }
  }
}

/**
 * Writes the period's usage to the ledger. Idempotent per
 * (organization, metric, period, arena), so re-running it corrects rather than
 * duplicates.
 */
export async function recordUsage(
  organizationId: string,
  metric: UsageMetric,
  quantity: number,
  opts: { arenaId?: string | null; at?: Date } = {}
) {
  const database = await db()
  const periodStart = periodStartFor(opts.at ?? new Date())
  // Written as SQL because the uniqueness it relies on is a partial expression
  // index — `coalesce(arena_id, …)`, so that one null arena counts as one row
  // rather than infinitely many — and Drizzle's typed `onConflictDoUpdate`
  // cannot name an expression as a conflict target.
  await database.execute(sql`
    insert into "usage_records" ("organization_id", "arena_id", "metric", "quantity", "period_start")
    values (${organizationId}, ${opts.arenaId ?? null}, ${metric}, ${quantity}, ${periodStart})
    on conflict ("organization_id", "metric", "period_start", coalesce("arena_id", '00000000-0000-0000-0000-000000000000'::uuid))
    do update set "quantity" = excluded."quantity", "recorded_at" = now()
  `)
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

function limitFor(plan: typeof schema.plans.$inferSelect, metric: UsageMetric): number | null {
  const column = LIMIT_FOR[metric]
  if (!column) return null
  return { maxArenas: plan.maxArenas, maxSessionsPerMonth: plan.maxSessionsPerMonth, maxStaff: plan.maxStaff }[column]
}

/**
 * Refuses the operation when the organization is already at its plan's limit.
 *
 * Called *before* the thing is created, at the point of use, on the server. A
 * hidden button is not a limit.
 *
 * Fails open when there is no subscription or no plan row: those are our
 * bookkeeping problems, and locking a venue out of its own arena over them
 * would be the wrong way round.
 */
export async function assertWithinPlanLimit(arenaIdOrOrg: { arenaId?: string; organizationId?: string }, metric: UsageMetric) {
  const organizationId = arenaIdOrOrg.organizationId ?? (await organizationIdForArena(arenaIdOrOrg.arenaId!))
  const subscription = await getSubscription(organizationId)
  if (!subscription) return

  const database = await db()
  const plan = await database.query.plans.findFirst({ where: eq(schema.plans.id, subscription.planId) })
  if (!plan) return

  const limit = limitFor(plan, metric)
  if (limit === null) return

  const used = await currentUsage(organizationId, metric)
  if (used < limit) return

  logger.info("billing.limit_reached", { organizationId, metric, limit, used, plan: plan.key })
  throw new AppError(
    "PLAN_LIMIT_REACHED",
    `Your ${plan.name} plan covers ${limit} ${METRIC_LABEL[metric].toLowerCase()}. Upgrade to add more.`
  )
}

/**
 * Refuses admin writes once a `PAST_DUE` grace period has run out.
 *
 * Never called from the storefront, the checkout or ticket validation — see
 * `canWriteAsAdmin` in `lib/domain/billing.ts` for why that line is where it is.
 */
export async function assertAdminWritable(arenaId: string) {
  const organizationId = await organizationIdForArena(arenaId)
  const subscription = await getSubscription(organizationId)
  if (canWriteAsAdmin(subscription ?? null)) return
  throw new AppError(
    "SUBSCRIPTION_INACTIVE",
    "This organization's Game Slots subscription is not active. Settle it to make changes again — your site and existing tickets are unaffected."
  )
}

// ---------------------------------------------------------------------------
// Reading it all back
// ---------------------------------------------------------------------------

export async function getBillingSummary(organizationId: string): Promise<BillingSummary> {
  const database = await db()
  const subscription = await getSubscription(organizationId)
  if (!subscription) throw notFound("Subscription")
  const plan = await database.query.plans.findFirst({ where: eq(schema.plans.id, subscription.planId) })
  if (!plan) throw notFound("Plan")

  const metrics: UsageMetric[] = ["ARENAS", "SESSIONS", "STAFF", "TICKETS"]
  const usage = await Promise.all(
    metrics.map(async (metric) => ({
      metric,
      label: METRIC_LABEL[metric],
      used: await currentUsage(organizationId, metric),
      limit: limitFor(plan, metric),
    }))
  )

  return {
    plan: {
      key: plan.key,
      name: plan.name,
      description: plan.description,
      priceMinor: plan.priceMinor,
      currency: plan.currency,
      interval: plan.interval,
      limits: { maxArenas: plan.maxArenas, maxSessionsPerMonth: plan.maxSessionsPerMonth, maxStaff: plan.maxStaff },
    },
    subscription: {
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      trialEndsAt: subscription.trialEndsAt,
      trialDaysLeft: trialDaysLeft(subscription),
      cancelledAt: subscription.cancelledAt,
    },
    usage,
    canWriteAsAdmin: canWriteAsAdmin(subscription),
  }
}

/** The billing summary for whichever organization owns this arena. */
export async function getBillingSummaryForArena(arenaId: string): Promise<BillingSummary> {
  return getBillingSummary(await organizationIdForArena(arenaId))
}

/** Every organization's subscription, for the platform's own screen. */
export async function listSubscriptions() {
  const database = await db()
  const rows = await database
    .select({
      organizationId: schema.organizations.id,
      organizationName: schema.organizations.name,
      organizationSlug: schema.organizations.slug,
      billingEmail: schema.organizations.billingEmail,
      status: schema.subscriptions.status,
      currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
      trialEndsAt: schema.subscriptions.trialEndsAt,
      planKey: schema.plans.key,
      planName: schema.plans.name,
      priceMinor: schema.plans.priceMinor,
      currency: schema.plans.currency,
    })
    .from(schema.subscriptions)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.subscriptions.organizationId))
    .innerJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
    .where(isNull(schema.organizations.deletedAt))

  return rows.map((row) => ({ ...row, live: isLive(row.status) }))
}

/** Platform-side change of plan or status, always recorded. */
export async function setSubscriptionPlan(
  organizationId: string,
  planKey: string,
  ctx: { actor: AuditActor; reason?: string }
) {
  const database = await db()
  const subscription = await getSubscription(organizationId)
  if (!subscription) throw notFound("Subscription")
  const plan = await getPlanByKey(planKey)
  if (!plan) throw notFound("Plan")

  await database
    .update(schema.subscriptions)
    .set({ planId: plan.id, updatedAt: new Date() })
    .where(eq(schema.subscriptions.id, subscription.id))

  await database.insert(schema.subscriptionEvents).values({
    subscriptionId: subscription.id,
    organizationId,
    type: "plan_changed",
    fromStatus: subscription.status,
    toStatus: subscription.status,
    metadata: { planKey, reason: ctx.reason ?? null },
  })

  await recordAudit(ctx.actor, {
    action: "subscription.plan_change",
    entityType: "subscription",
    entityId: subscription.id,
    description: `Moved organization to the ${plan.name} plan`,
  })

  return getBillingSummary(organizationId)
}
