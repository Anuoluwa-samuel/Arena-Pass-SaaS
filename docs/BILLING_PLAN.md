# Platform billing — implementation plan

What it takes to charge organizations for Game Slots, starting from the schema
that already exists and nothing else.

> Status today: `plans`, `subscriptions`, `subscription_events` and
> `usage_records` exist as tables and are never read or written. No service, no
> route, no screen, no seeded plan. Organizations run unlimited arenas,
> sessions and staff for free. See [BILLING.md](BILLING.md).

---

## Decisions to make before Phase 1

These change what gets built, not just how. Each has a recommendation.

### 1. What is being sold

The schema assumes a **per-organization subscription** with limits on arenas,
sessions per month and staff. That is one of three plausible models:

| Model | Fits when | Cost to build |
|---|---|---|
| **Per-organization plan with limits** (what the schema assumes) | Venues are small and predictable | Lowest — the schema is already shaped for it |
| **Per-arena flat fee** | Multi-location operators are the norm | Moderate — `subscriptions` is keyed per organization, so this needs a rethink |
| **Commission on ticket sales** | You want to grow with your customers | Highest — needs settlement, and it changes who holds the money at checkout |

**Recommendation:** per-organization plan with limits. It is what the tables
support, it is the easiest to explain to a venue owner, and commission can be
added later as a second line item without unpicking it.

### 2. What happens when a payment fails

The important question, because the wrong answer punishes the venue's
customers for the venue's expired card.

**Recommendation:** never break the storefront. A `PAST_DUE` organization keeps
its public site, its existing tickets and its ability to validate at the gate —
those involve money already taken from members of the public. What it loses,
after a grace period, is *admin write access*: no new sessions, no new staff.
The distinction to hold onto is that a billing failure is between the platform
and the venue, and a customer holding a paid ticket is not party to it.

### 3. Who may manage the subscription

**There is no organization-level role.** Permissions are either arena-scoped
(through `arena_memberships`) or platform-scoped (through
`users.platform_role_id`). An organization has a `created_by_user_id` and a
`billing_email` and no members of its own.

| Option | |
|---|---|
| **A new arena permission `billing.manage`, granted to `ARENA_OWNER`** | An owner of any arena in the organization manages its subscription. Simple; slightly loose when one organization holds several arenas under different owners |
| **Organization memberships** | A new table, a third permission scope, and changes to the authorization choke point. Correct, and a lot of machinery for a model where organizations usually have one owner |
| **Only `created_by_user_id`** | Simplest, and brittle: the person who signed up leaves and nobody can pay the bill |

**Recommendation:** the new `billing.manage` arena permission. It reuses the
existing choke point, and the looseness only bites for a shape (one
organization, several arenas, distinct owners) that does not exist yet. Revisit
if it does.

### 4. Proration

**Recommendation:** none at first. Upgrades take effect immediately and charge
the full new price at the next renewal; downgrades take effect at period end.
Proration is arithmetic nobody disputes until they do, and it can be added
without changing the model.

---

## Phase 1 — Plans and trials, no money

The catalogue exists, every organization has a subscription, nothing is
charged. Shippable on its own: it makes the state visible before it can go
wrong.

- Seed a plan catalogue. Prices are yours to set; the seed needs at least one
  public plan and one internal "comped" plan for venues you do not charge.
- `server/services/billing.ts`: `listPlans`, `getSubscription(organizationId)`,
  `startTrial(organizationId, planId)`, `recordSubscriptionEvent`.
- `registerArena` opens a `TRIALING` subscription on the default plan inside
  its existing transaction — a new organization must never exist without one.
- Backfill: every organization that predates this gets a subscription, in a
  migration.
- Platform → Subscriptions: a list with status, plan, period end, gated on
  `platform.subscriptions.view`.
- Arena admin → Billing: the organization's plan, status and renewal date,
  read-only, gated on the new `billing.manage`.
- Tests: an organization always has exactly one subscription; the trial ends
  when it says it does; an arena owner cannot read another organization's
  subscription.

## Phase 2 — Usage and limits, still no money

- `recordUsage(organizationId, metric, arenaId)` writing `usage_records`,
  called where arenas, sessions and staff are created.
- `assertWithinPlanLimit(organizationId, metric)` called at those same points,
  server-side. A null limit means unlimited.
- The `PAST_DUE` rule from decision 2: admin writes blocked after the grace
  period, storefront and ticket validation untouched.
- Usage on both billing screens, so a venue can see why it is being asked to
  upgrade.
- Tests: limits count across every arena in the organization and never across
  organizations; a blocked write says which limit and which plan; the
  storefront and `validateTicket` keep working for a `PAST_DUE` organization.

## Phase 3 — Taking the first payment

The phase with the real risk in it, because it introduces a second flow of
money into a codebase that deliberately has one.

- **The platform's own provider account**, with credentials entirely separate
  from any arena's. `resolvePaymentAccount` must never return it and
  `getPaymentProviderForArena` must never reach it — a subscription charge
  landing in an arena's account, or the reverse, is the worst bug this feature
  can have.
- `chargeAuthorization` added to the `PaymentProvider` interface, plus the
  Paystack and mock adapters. Recurring charges use a stored authorization
  rather than the provider's own subscription objects, so the abstraction stays
  honest and a second provider stays possible.
- First payment is a hosted checkout, as bookings are. The authorization code
  it returns is stored encrypted for renewals.
- **A separate webhook endpoint** — `/api/platform/billing/webhook` — with its
  own signing secret. The booking webhook looks references up in `payments` and
  drops what it does not find, so a subscription event sent there is silently
  discarded. Two endpoints keeps the domains apart, which is what
  `BILLING.md` already promises.
- `server/billing/state.ts`, mirroring `server/payments/state.ts`: the legal
  transitions between `TRIALING`, `ACTIVE`, `PAST_DUE`, `CANCELLED` and
  `EXPIRED`, with anything else refused rather than written.
- Tests: replayed webhooks are acknowledged once; a subscription reference is
  refused by the booking webhook and vice versa; impossible transitions throw;
  the platform account is never reachable from arena code.

## Phase 4 — Renewals, dunning, receipts

- Cron charges subscriptions whose period has ended, idempotently — a cron that
  runs twice must not bill twice.
- A retry schedule on failure, then `PAST_DUE`, then `EXPIRED`. The exact
  cadence is a business decision; three attempts over a week is a common
  default.
- Emails through the existing `notify()`: trial ending, payment failed, payment
  taken, subscription expired.
- Receipts as stored records, not generated from live data, so a receipt
  reissued next year says what it said the day it was sent.
- Tests: a double-run of the cron produces one charge; the dunning ladder moves
  a subscription through every status in order and stops.

## Phase 5 — Self-serve changes

- Upgrade, downgrade and cancel from the billing screen, following decision 4.
- Cancel at period end by default; the organization keeps what it paid for
  until the period it paid for ends.
- Platform overrides: comp a plan, extend a trial, forgive a period — each
  audited, because they are the operations most worth being able to explain
  later.

---

## What does not change

Customer payments are untouched. `payments`, `transactions` and the arena
payment accounts keep their tables, their statuses and their code path. The
only shared thing is the `PaymentProvider` interface, and it gains one method.

The tenant isolation model is untouched too. Subscriptions are scoped by
`organization_id`, which is a level above `arena_id`, so every limit check
counts across the arenas of one organization and never across organizations.
That is a new scope for the invariant tests to cover, not a new exception to
the existing ones.

## Rough shape of the work

Phases 1 and 2 are the larger part of the value and carry almost none of the
risk — they make billing state real and visible without money moving. Phase 3
is where care is needed. Phases 4 and 5 are mechanical once 3 is right.

A sensible first cut is Phases 1 and 2 together, then a pause to see whether
the model fits real venues before building the charging around it.
