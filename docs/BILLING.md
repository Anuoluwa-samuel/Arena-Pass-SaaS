# Billing

> **Nothing is charged yet.** Plans, trials, usage and limits are built and
> enforced; taking money for a subscription is not. An organization on a plan
> that it exceeds is refused the operation, but an organization that never pays
> is never chased. Phases 3–5 of [BILLING_PLAN.md](BILLING_PLAN.md) are the
> rest.
>
> Customer payments — an arena's customers paying that arena — are fully built
> and unaffected by any of this.

Two financial domains live in this system. They must never be confused.

| | An arena's customers → the arena | An organization → Game Slots |
| --- | --- | --- |
| What | A football slot | The SaaS subscription |
| Tables | `payments`, `transactions` | `plans`, `subscriptions`, `subscription_events`, `usage_records` |
| Statuses | `PENDING / PAID / FAILED / REFUNDED` | `TRIALING / ACTIVE / PAST_DUE / CANCELLED / EXPIRED` |
| Provider account | The **arena's** own | The platform's |
| Scoped by | `arena_id` | `organization_id` |
| Surface | Arena admin → Payments | Platform → Subscriptions |

They share no table, no status vocabulary and no code path. A bug in football
ticketing cannot reach a subscription, and a failed subscription charge can
never present as a failed booking.

## Customer payments

Covered in `docs/PAYMENTS` terms by the payment service:

- The amount is computed server-side from the session's own price. A
  client-supplied amount is never trusted, and the provider's reported amount
  must match exactly or the payment is flagged rather than confirmed.
- Money is integer minor units throughout (`500000` = ₦5,000.00). No floats.
- Each arena is paid into **its own** provider account
  (`arena_payment_accounts`), with credentials encrypted at rest. Past the
  first arena there is no platform fallback: an arena with no account cannot
  take payments, rather than paying into someone else's.
- `server/payments/state.ts` names the legal transitions. `PAID` can only
  become `REFUNDED`; a late "failed" event cannot un-pay a customer holding a
  ticket.

## Subscriptions

- `plans` describes what is on sale: price in minor units, interval, and the
  limits a plan implies (`max_arenas`, `max_sessions_per_month`, `max_staff`;
  null means unlimited).
- `subscriptions` holds **one live subscription per organization**, with its
  period and status. History is append-only in `subscription_events`, so a
  status change is never silently overwritten.
- `usage_records` counts what an organization actually used in a period, keyed
  `(organization, metric, period, arena)`. It serves both billing and limit
  enforcement, and it is per arena as well as per organization so a
  multi-location organization can see where its usage went.

## Feature flags

Capabilities are gated per arena: a platform default in `feature_flags`, an
optional override in `arena_feature_flags`. `isFeatureEnabled(arenaId, flag)`
is read **on the server** for anything that matters — hiding a button is not a
feature gate.

## What a lapsed subscription does, and does not, do

A failed charge is between the platform and the venue. The person who already
paid for a slot is not party to it, so:

- **Never affected:** the storefront, booking, checkout, ticket issue and gate
  validation. An integration test books, pays for and admits a customer while
  the organization is `EXPIRED`, because that is the promise most worth having
  a test for.
- **Affected, after a grace period:** admin writes. No new sessions, no new
  staff. `PAST_DUE` keeps working for `PAST_DUE_GRACE_DAYS` past the period
  end; after that, and for `EXPIRED` or `CANCELLED`, admin writes are refused
  with `SUBSCRIPTION_INACTIVE` (HTTP 402).

An organization with no subscription at all, or on a plan row that has gone
missing, **fails open**. That is our bookkeeping problem, and locking an
operator out of their own arena over it would be the wrong way round.

## Limits

`assertWithinPlanLimit` runs server-side before the thing is created. Counts
come from the tables themselves rather than from `usage_records`, because a
counter that drifts either blocks an operator who has room or admits one who
does not; `usage_records` is the historical ledger, not the live truth.

`STAFF` counts **distinct people** across the organization's arenas — one
person working at two of your venues is one member of staff.

**`max_arenas` cannot bind today.** Every registration creates a *new*
organization, so an operator opening a second venue gets a second organization
and a second subscription rather than a second arena under the first. The limit
is stored, displayed and counted; it will only ever refuse anything once an
arena can be added to an existing organization, which is its own piece of
product work.

## Not built yet

Charging. There is no provider integration for subscriptions, no renewal, no
dunning, no invoices and no self-serve plan change. The separation was built
first on purpose — customer payments and platform subscriptions share no table,
no status vocabulary and no code path — because that is the expensive thing to
retrofit. [BILLING_PLAN.md](BILLING_PLAN.md) phases 3–5 are the rest.
