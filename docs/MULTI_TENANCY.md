# Multi-tenancy

How Arena A is isolated from Arena B.

## The short version

> A request's arena is derived from the authenticated principal's membership,
> never from anything the client supplied. Every data access goes through a
> service that was handed that arena id and filters on it. And the database
> refuses any row whose parent belongs to a different arena, through composite
> foreign keys on `(arena_id, id)`.
>
> So bypassing the interface, the route, or the service layer still fails at
> the storage layer.

## The tenant boundary

```
Platform
  └── Organization            billing owner; one per arena today, the schema allows more
        └── Arena             ← THE TENANT BOUNDARY
              ├── arena_memberships   user × arena × role — the only thing that grants access
              ├── customers           scoped to the arena; the same person at two arenas is two accounts
              ├── sessions → teams → session_slots
              ├── bookings → payments → tickets → ticket_validations
              ├── cms_pages / media / branding / arena_domains
              └── notifications / audit_logs / analytics
```

`arenas.id` is the tenant key. Every tenant-owned table carries `arena_id`.

## Five layers, in request order

### 1. Addressing — which arena is this request *for*?

`server/tenant/resolver.ts` turns a hostname into an arena:

1. a **verified** custom domain (`arena_domains.status = 'VERIFIED'`);
2. a single-label subdomain of the configured root (`lekki.arenapass.com`);
3. a development-only slug override, refused in production;
4. the sole arena, *only* while the database holds exactly one.

The Host header is attacker-controlled, so it selects a public tenant and
proves nothing. `normalizeHostname` rejects anything that is not a bare
hostname. A subdomain that matches no arena is a dead end — it does **not**
fall through to rule 4, which would serve one arena on another's address.

**The platform's own hostname.** The root domain and its `www` form
(`arenapass.com`, or `localhost` in development) belong to no arena, because
they are where an operator arrives *before* they have one. At the root path
they serve the platform's welcome and sign-up pages; every other path there is
a 404, since `/sessions`, `/login`, a ticket and a checkout callback are all
meaningful only inside an arena. `isPlatformHost()` is deliberately narrow —
only the root and `www`, never a subdomain that merely failed to resolve — so
wildcard DNS does not turn every name anyone tries into a marketing page.

A deployment holding exactly one arena still resolves that arena at its root
by rule 4, so a single-arena installation keeps its own site on its own domain
rather than being replaced by platform marketing.

### 2. Authorisation — may this caller act there?

`server/tenant/authorization.ts` is the only place that answers it, and it
recognises two grants that are never interchangeable:

| Grant | Held through | Satisfies |
| --- | --- | --- |
| Arena permission | an **ACTIVE** `arena_memberships` row | `sessions.view`, `payments.refund`, … |
| Platform permission | `users.platform_role_id` | `platform.arenas.manage`, … |

A platform role grants **no** tenant access. Crossing that line requires
impersonation: explicit, reasoned, audited, read-only and expiring in 30
minutes.

For admin requests, `server/tenant/admin-scope.ts` decides which arena is being
acted on: the addressed hostname (the caller must be a member, or the request
is refused rather than redirected to an arena they *do* belong to), then their
remembered choice, then their only membership, then "choose one".

### 3. The service layer

Every tenant-facing service takes the arena as its first argument, and the
arena is part of the `WHERE` rather than a check afterwards. Another arena's id
matches no row, so a read is **not found** and a write is a no-op.

"Not found" rather than "forbidden" is deliberate: forbidden confirms the id
exists, which is how an attacker enumerates another arena's bookings.

`server/db/scoped.ts` makes the scoped query the short one —
`scope.owns(tickets, eq(tickets.id, id))` is less typing than assembling the
filter by hand. An ESLint rule forbids `app/**` from importing the database at
all, so a route cannot write a query nobody reviewed for tenant scope.

Four reads are deliberately unscoped, each saying why in the code: the provider
webhook path (the arena comes from the payment record), the platform cron
sweeps, the public ticket link, and file serving by opaque storage key.

### 4. The database

- `arena_id` is `NOT NULL` on every tenant-owned table. Two exceptions are
  documented in the schema: `audit_logs` and `notifications` allow null for
  platform-level rows, and because every query is an equality test, such a row
  is invisible to *every* tenant rather than visible to all of them.
- 22 **composite foreign keys**: children carry `(arena_id, parent_id)` and
  reference the parent's `(arena_id, id)`. A booking cannot point at another
  arena's session, customer, slot or team; a ticket cannot point at another
  arena's booking; a ledger entry cannot point at another arena's payment.
- Uniqueness sits where it belongs: `customers(arena_id, lower(email))` and
  `bookings(arena_id, idempotency_key)` are per arena, while ticket numbers,
  QR tokens and payment references stay globally unique because they are
  printed, scanned and quoted to a payment provider.
- Indexes lead with `arena_id` on the paths that are always tenant-scoped.

### 5. Everything around the request

- **Caching.** Resolving the tenant reads request headers, which makes every
  page and route dynamic — the production build prerenders exactly one route,
  the 404 page. The two cacheable public endpoints declare
  `Vary: Host, X-Arena-Slug`. Failures are `no-store`.
- **Rate limits** are keyed `(arena, identifier)`, so one tenant cannot exhaust
  another's allowance from a shared address.
- **Payments.** Each arena holds its own provider credentials, encrypted at
  rest. Past the first arena there is no platform fallback: an arena with no
  account of its own cannot take payments, rather than paying into someone
  else's.
- **Tickets.** Each arena signs its QR codes with its own derived key, so a
  code minted for one arena fails the signature check at another's gate before
  any lookup.
- **Branding and email** come from the arena, not the platform.

## What a tenant cannot do

Tested in `tests/integration/cross-tenant-services.test.ts`,
`tenant-constraints.test.ts`, `authorization.test.ts` and `invariants.test.ts`:

read, list, create, update, delete, book into, pay for, refund, scan, cancel or
even *reference* another arena's rows — as any role, from any address, with or
without knowing the ids.

## Adding a feature without breaking this

1. Give the table `arena_id NOT NULL` and a composite foreign key to its parent.
2. Take `arenaId` as the service function's first parameter and use
   `forArena(arenaId)`.
3. Get the arena from `adminRoute`'s fourth argument or
   `requirePublicTenantFromRequest` — never from the request body.
4. Add the cross-tenant case to the test suite: the same call, from the other
   arena, must fail.
