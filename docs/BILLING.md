# Billing

> **Subscription billing is not built.** The tables below exist and are never
> read or written: no plan is seeded, no organization has a subscription,
> nothing is charged and no plan limit is enforced. Everything in the
> *Subscriptions* and *Feature flags* sections describes the schema, not
> working behaviour — except feature flags, which are wired.
> [BILLING_PLAN.md](BILLING_PLAN.md) sets out what it would take.
>
> Customer payments — an arena's customers paying that arena — are fully built
> and in production use. That is the first column below.

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

## Not built yet

To be exact about the gap: there is no billing service, no API route, no
screen, and the `plans` table is never populated. The only code outside the
schema that mentions subscriptions is the status list in
`lib/domain/constants.ts`.

The separation was built first on purpose — customer payments and platform
subscriptions share no table, no status vocabulary and no code path — because
that is the expensive thing to retrofit. The charging goes on top.
[BILLING_PLAN.md](BILLING_PLAN.md) is the plan for it.
