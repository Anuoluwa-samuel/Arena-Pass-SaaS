import type { SubscriptionStatus, UsageMetric } from "./constants"

/**
 * Billing rules that both the server and the browser need to agree on.
 *
 * Client-safe on purpose: the billing screens render the same verdicts the
 * server enforces, so an operator is never told they have room for another
 * arena by a screen that the API then refuses.
 */

/**
 * How long a `PAST_DUE` organization keeps working normally.
 *
 * A failed charge is between the platform and the venue. Cutting a venue off
 * the moment a card expires punishes people who have already paid for a slot,
 * so there is a week to notice the emails before anything changes — and even
 * then, only admin writes stop. See `canWriteAsAdmin`.
 */
export const PAST_DUE_GRACE_DAYS = 7

/** Statuses that let an organization use the product at all. */
const LIVE_STATUSES: readonly SubscriptionStatus[] = ["TRIALING", "ACTIVE", "PAST_DUE"]

export function isLive(status: SubscriptionStatus): boolean {
  return LIVE_STATUSES.includes(status)
}

export interface SubscriptionSnapshot {
  status: SubscriptionStatus
  currentPeriodEnd: Date
  trialEndsAt: Date | null
}

/**
 * Whether an operator may still make changes in the admin.
 *
 * Deliberately narrow: this gates *admin writes only*. The storefront, the
 * checkout, existing tickets and gate validation are never gated on billing,
 * because a customer holding a paid ticket is not party to a dispute between
 * the platform and the venue. Taking a venue's gate offline over an expired
 * card would turn a billing problem into a queue of angry people at a turnstile.
 */
export function canWriteAsAdmin(snapshot: SubscriptionSnapshot | null, now = new Date()): boolean {
  // No subscription at all: this predates billing, or something failed to
  // create one. Failing open is right — the alternative locks an operator out
  // of their own arena over our bookkeeping.
  if (!snapshot) return true
  if (snapshot.status === "TRIALING" || snapshot.status === "ACTIVE") return true
  if (snapshot.status === "PAST_DUE") {
    const graceEnds = new Date(snapshot.currentPeriodEnd.getTime() + PAST_DUE_GRACE_DAYS * 86_400_000)
    return now < graceEnds
  }
  return false
}

/** Days left of a trial, or null when this is not a trial. */
export function trialDaysLeft(snapshot: SubscriptionSnapshot | null, now = new Date()): number | null {
  if (!snapshot || snapshot.status !== "TRIALING" || !snapshot.trialEndsAt) return null
  return Math.max(0, Math.ceil((snapshot.trialEndsAt.getTime() - now.getTime()) / 86_400_000))
}

export interface PlanLimits {
  maxArenas: number | null
  maxSessionsPerMonth: number | null
  maxStaff: number | null
}

/** The plan column each metric is measured against. `null` means unlimited. */
export const LIMIT_FOR: Record<UsageMetric, keyof PlanLimits | null> = {
  ARENAS: "maxArenas",
  SESSIONS: "maxSessionsPerMonth",
  STAFF: "maxStaff",
  // Counted for visibility and future usage-based pricing; nothing caps it.
  TICKETS: null,
}

export const METRIC_LABEL: Record<UsageMetric, string> = {
  ARENAS: "Arenas",
  SESSIONS: "Sessions this month",
  STAFF: "Staff",
  TICKETS: "Tickets sold this month",
}

/** The first instant of the billing month a moment falls in, in UTC. */
export function periodStartFor(at: Date = new Date()): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
}
