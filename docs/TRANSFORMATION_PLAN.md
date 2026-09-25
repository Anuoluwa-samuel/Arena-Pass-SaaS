# Arena Pass — Multi-Tenant SaaS Transformation Plan

Date: 2026-09-24
Working copy: `~/Desktop/arena-pass-saas` (copied from `~/Downloads/play-pass-e-ticketing-ui` at `a431683`; the original is untouched and remains the fallback).

This document is the output of **Phase 1 (audit + target design)**. It records what the
existing system actually does, where the tenant boundary leaks today, and the ordered
phase plan for the transformation.

---

## 1. Audit — what already exists

The starting point is stronger than a typical "single-arena app". ~21,500 LOC of
TypeScript across `app/`, `server/`, `lib/`, `components/`, with real tests.

| Area | State |
| --- | --- |
| Framework | Next.js 16 App Router, React 19, TS strict, Tailwind 4, shadcn/ui, Motion |
| DB | PostgreSQL via Drizzle; PGlite embedded for local dev; 4 SQL migrations committed |
| Schema | 24 tables. **`arenas` already exists as a root table** and `arena_id` is present on `sessions`, `bookings`, `tickets`, `payments`, `transactions`, `media`, `cms_*`, `faqs`, `announcements`, `banners`, `notifications`, `audit_logs`, `system_settings` |
| Capacity | Modelled properly: `teams` + pre-generated `session_slots` (8×4), `UNIQUE(session_id, team_number, slot_number)`, `UNIQUE(booking_id)`, CHECK `booked + held <= capacity` |
| Concurrency | `createBooking` runs in a transaction: `SELECT … FOR UPDATE` on the session row, slot claim via `FOR UPDATE SKIP LOCKED`, oversell caught by a CHECK constraint. **This is already correct.** |
| Reservations | `HELD → CONFIRMED` with `expires_at`, server-side expiry sweep + housekeeping cron |
| Idempotency | `bookings.idempotency_key` unique; `payments.reference` unique; unique-violation replay handled |
| Money | Integer minor units throughout (`ticket_price`, `amount` as `integer`) — no floats |
| Auth | DB-backed server sessions (`auth_sessions`), httpOnly cookies, SHA-256 token hashes, scrypt passwords, hashed single-use reset tokens, Google OAuth |
| RBAC | `roles` + `role_permissions` in DB, 25 permissions, `requirePermission()` used by every admin route via `adminRoute()` |
| Payments | Provider abstraction (`mock`, `paystack`), webhook signature verification + re-verify against provider API, refund-required flagging |
| Tickets | Opaque `qr_token`, unique; `ticket_validations` audit table |
| Security plumbing | Same-origin assertion on mutations, rate limiting, structured logger, `server-only` boundaries, prod startup guards |
| Tests | 8 unit, 6 integration (incl. booking flow, hold release, payment recovery, schema constraints), 2 e2e specs |
| Docs | ARCHITECTURE, DATABASE, API, SECURITY, DEPLOYMENT, DESIGN, AUDIT |

**Conclusion:** concurrency, money handling, payment verification and session management
are already at production quality. The transformation is therefore *not* a rewrite — it
is the introduction of a real tenant boundary through a codebase that currently assumes
"there is one arena".

---

## 2. Audit — where the tenant boundary leaks today

These are the concrete defects the transformation must close.

### 2.1 There is no tenant, only a default arena
`server/services/arenas.ts::getDefaultArena()` resolves the arena with slug `main`, or
"any active arena". Every public page calls it. `server/http/admin.ts::resolveArenaId()`
falls back to the default arena for any admin user whose `arena_id` is null. With two
arenas in the database, a super admin silently operates on whichever arena is "first".

### 2.2 Services are arena-unscoped
Roughly **55 of ~60 exported service functions take an id with no arena parameter.**
Examples that are direct IDOR vectors once a second arena exists:

```
getBookingById(id)              cancelPendingBooking(id, ctx)
listBookingsForSession(id)      getSessionById(id)
getCustomerDetail(id)           updateCustomer(id, patch)
getTicketById(id)               getTicketByNumber(number)
getMedia(id) / updateMedia(id) / deleteMedia(id)
updateService/Faq/Announcement/Banner(id, …)
listCustomers(opts)             listMedia(opts)
listNotifications(opts)         listAuditLogs(opts)
validateTicket(code, …)
```

None of these can currently be safe, because the arena is never passed in.

### 2.3 Identity is coupled to one arena, or to none
- `users.arena_id` is a nullable column with `ON DELETE SET NULL` — a user belongs to at
  most one arena, and null means "platform-wide/default". There is no membership table,
  so a user cannot belong to two arenas, and staff suspension per-arena is impossible.
- `roles.key` is a **global** enum with a global unique key. Platform roles and arena
  roles share one namespace; `SUPER_ADMIN` is effectively a platform role with implicit
  access to the default arena.
- `customers` has a **globally unique lowercase email** and a nullable `arena_id`. Two
  arenas cannot each have a customer with the same email address, and
  `upsertCustomerByEmail()` will happily return Arena B's customer to Arena A.

### 2.4 No cross-tenant relationship enforcement in the database
`bookings.arena_id` and `bookings.session_id` are independent foreign keys. Nothing at
the database level prevents an Arena A booking pointing at an Arena B session. Same for
`tickets`, `payments`, `transactions`, `cms_services.image_media_id`.

### 2.5 Tables missing a tenant reference
`teams`, `session_slots`, `waitlist_entries`, `ticket_validations`, `password_reset_tokens`,
`auth_sessions` carry no `arena_id`. Some are derivable via a parent, but derivation is
exactly what composite keys exist to make unnecessary.

### 2.6 Nullable tenant columns
`media`, `cms_pages`, `cms_services`, `faqs`, `announcements`, `banners`, `notifications`,
`audit_logs` all allow `arena_id IS NULL`. A null arena_id row is visible to every tenant
under any "where arena_id = X or arena_id is null" convenience query.

### 2.7 Global uniqueness that should be per-arena
`arenas.slug` is correctly global. But `tickets.ticket_number` uses one global sequence,
`customers.username` is globally unique, and `system_settings` uses a sentinel-UUID trick
for the platform scope. Session titles, CMS slugs etc. must be unique *within* an arena.

### 2.8 No organization layer, no subscriptions, no platform admin
No `organizations`, `plans`, `subscriptions`, `usage_records`, `arena_payment_accounts`,
`arena_domains`. Payment provider credentials are global environment variables, so every
arena's money would land in one Paystack account. There is no platform control centre and
no separation between "customer pays for football" and "arena pays for Arena Pass".

### 2.9 No host-based tenant resolution
No middleware, no subdomain or custom-domain handling. Public routes are `/sessions`,
not `/{arena}/sessions` or `lekki.arenapass.com/sessions`.

### 2.10 Cache and background jobs are tenant-blind
`sweepExpiredHolds()` uses a process-global throttle; `syncSessionLifecycle()` and the
housekeeping cron iterate everything with no tenant context. Next.js caching of public
pages currently assumes one arena per deployment — the single most dangerous leak once
hosts map to tenants.

---

## 3. Target architecture (summary)

```
Platform
  └── Organization (billing owner)
        └── Arena  ← THE TENANT BOUNDARY
              ├── memberships (user × arena × role)
              ├── customers (scoped to arena)
              ├── sessions → teams → slots
              ├── bookings → payments → tickets → scans
              ├── cms / media / branding / domains
              └── analytics / audit / notifications
```

Enforcement layers, in order of the request lifecycle:

1. **Middleware** resolves host → arena candidate (never authoritative for authz).
2. **Tenant context** (`server/tenant/context.ts`) resolves the *authoritative* arena from
   the authenticated principal's membership, not from the request body.
3. **Authorization** (`authorize({ actor, arenaId, permission })`) — single choke point.
4. **Scoped repositories** — `forArena(arenaId)` returns a handle whose every query is
   pre-filtered; unscoped access lives in a separate, lint-restricted module.
5. **Database constraints** — composite FKs `(arena_id, id)` so a cross-tenant row cannot
   be written even if every layer above is bypassed.

"How Arena A is isolated from Arena B", in one sentence for a reviewing engineer: *a
request's arena is derived from the authenticated principal's membership record, every
data access goes through a repository handle that was constructed from that arena id, and
the database refuses any row whose parent belongs to a different arena via composite
foreign keys — so bypassing the UI, the route, or the service layer still fails at the
storage layer.*

---

## 4. Phase plan — **16 phases in 5 stages**

The spec's §84 lists 20 phases; several collapse because the work already exists
(concurrency, money, payment verification) and others split because they are too large to
verify in one pass (the service-layer migration). Each phase ends with a green
`typecheck + lint + test` and a working app — no phase leaves the tree broken.

### Stage I — Foundation (no behaviour change)

| # | Phase | Deliverable | Risk |
| --- | --- | --- | --- |
| **0** | Baseline & guardrails | Deps installed, baseline `typecheck`/`test`/`e2e` recorded, git branch, ESLint rules that will later forbid unscoped DB access | none |
| **1** | Audit & target design | *this document* + `docs/MULTI_TENANCY.md` skeleton | none |
| **2** | Tenancy data model | `organizations`, `arena_memberships`, per-arena roles, `arena_domains`, `arena_payment_accounts`, tenant columns on every tenant-owned table; migration + **idempotent backfill** (default org → default arena → existing users become owners/staff) | high |
| **3** | Tenant context & resolution | `server/tenant/{context,resolver,guards}.ts`, middleware for host/subdomain/`/a/[slug]` dev path, arena status checks | medium |
| **4** | Centralized authorization | Permission vocabulary v2 (platform vs arena), `authorize()`, membership-aware `requirePermission`, removal of `resolveArenaId()` fallback | high |

### Stage II — Enforcement (the core of the work)

| # | Phase | Deliverable | Risk |
| --- | --- | --- | --- |
| **5** | Tenant-scoped data layer | `forArena(arenaId)` repository handles; migrate all ~60 service functions to take an explicit arena; unscoped access quarantined behind `server/db/unsafe.ts` + lint rule | high |
| **6** | DB constraints & indexes | Composite unique keys `(arena_id, id)`, composite FKs on bookings/tickets/payments/transactions/slots, per-arena uniqueness, `NOT NULL` on tenant columns, `(arena_id, …)` leading indexes | high |
| **7** | Identity & auth migration | Users via memberships, customers scoped per arena (`UNIQUE(arena_id, lower(email))`), auth sessions carry tenant, email verification, per-arena suspension, session revocation on role change | high |

### Stage III — Domain surfaces

| # | Phase | Deliverable | Risk |
| --- | --- | --- | --- |
| **8** | Tenant-aware payments | Per-arena payment accounts (provider creds never in the browser), server-authoritative amounts, explicit payment state machine, webhook: signature + raw body + replay protection + idempotent event store, arena resolved from the payment record not the payload | high |
| **9** | Tickets & validation | Signed/opaque ticket tokens with integrity check, validation chain (format → signature → existence → status → arena → session → reuse), transactional idempotent scans, scan audit rows | medium |
| **10** | CMS, media, branding, notifications, analytics | Per-arena CMS + sanitisation, per-arena media with random object keys and validated uploads, tenant-aware email templates, tenant-scoped analytics aggregation | medium |

### Stage IV — Product surfaces

| # | Phase | Deliverable | Risk |
| --- | --- | --- | --- |
| **11** | Customer storefront per tenant | Arena-branded public site, tenant-safe caching/cache keys, no-store on account/ticket/payment pages, booking UX unchanged for the customer | medium |
| **12** | Arena admin + onboarding | Tenant identity in the shell, membership-driven arena switcher, resumable onboarding wizard (account → verify → org → arena → branding → payments → first session → staff → launch) | medium |
| **13** | Platform admin & billing | Separate platform control centre, audited time-limited impersonation, plans/subscriptions/usage separate from customer payments, tenant-aware feature flags | medium |

### Stage V — Proof

| # | Phase | Deliverable | Risk |
| --- | --- | --- | --- |
| **14** | Security & concurrency test suite | Multi-tenant seed (Arena A/B, distinct owners/staff/customers), full cross-tenant matrix, IDOR, privilege escalation, webhook forgery/replay, concurrent booking (100 → 32), concurrent scan, invariant tests | medium |
| **15** | Hardening, docs, final audit | CSP/headers/CORS, CSRF review, rate limits, upload hardening, observability; `MULTI_TENANCY.md`, `THREAT_MODEL.md`, `SECURITY.md`, `BILLING.md`, `OPERATIONS.md`; adversarial review as every role in Arena A against Arena B | low |

### Ordering rules

- Phases 2 → 7 are strictly sequential; each depends on the previous schema/API shape.
- 8, 9, 10 may be reordered but all depend on 5–7.
- 14 is written incrementally *during* 5–13; Phase 14 is the consolidation and the
  adversarial pass, not the first time tests are written.
- No phase is declared done on "it compiles". Done = typecheck + lint + unit + integration
  green, plus the phase's own new tests, plus the app runs.

---

## 5. Known decisions taken

- **No new runtime dependencies** unless a phase justifies one in writing. Expected
  candidates: an HTML sanitiser for CMS rich text (Phase 10), and `@node-rs/argon2` is
  explicitly *not* adopted — scrypt stays, as specified.
- **One org → many arenas** in the schema from day one, even though the product ships
  one arena per org initially.
- **Customers are arena-scoped by default.** A cross-arena customer identity is a future
  product decision, not a default.
- **Migration is additive and idempotent.** No destructive SQL; backfill can be re-run.
  The original repo stays in `~/Downloads` untouched as a recovery point.

---

## 6. Status

- [x] **Phase 0 — baseline & guardrails.** Dependencies installed, branch
  `multi-tenant-saas`. Baseline recorded: typecheck clean, lint 0 errors
  (5 pre-existing warnings), 135 tests passing.
- [x] **Phase 1 — audit & design.** This document.
- [x] **Phase 2 — tenancy data model.** See below.
- [x] **Phase 3 — tenant context & resolution.** See below.
- [x] **Phase 4 — centralized authorization.** See below.
- [x] **Phase 5 — tenant-scoped data layer.** See below.
- [x] **Phase 6 — database constraints & indexes.** See below.
- [x] **Phase 7 — identity & auth migration.** See below.
- [x] **Phase 8 — tenant-aware payments.** See below.
- [x] **Phase 9 — tickets & validation.** See below.
- [x] **Phase 10 — content, media & branding.** See below.
- [x] **Phase 11 — storefront & cache safety.** See below.
- [x] **Phase 12 — onboarding & admin UX.** See below.
- [x] **Phase 13 — platform admin & billing.** See below.
- [x] **Phase 14 — security & concurrency suite.** See below.
- [x] **Phase 15 — hardening, docs & final audit.** See below.

**All 16 phases complete.**

### Phase 2 record

**Schema** (`0004_multitenancy.sql`, additive only):

- New tables: `organizations`, `arena_memberships`, `arena_domains`,
  `arena_payment_accounts`.
- `arenas` gained `organization_id`, `status`, `description`, branding
  (`logo_media_id`, `brand_primary_color`, `brand_accent_color`),
  `onboarding_step`, `launched_at`.
- `roles.key` converted from a Postgres enum to text with a CHECK constraint —
  an enum cannot gain values inside a migration transaction and then have them
  used, which the role rename requires. `roles.scope` added.
- `users` gained `platform_role_id` and `email_verified_at`.
- `arena_id` added to `teams`, `session_slots`, `waitlist_entries`,
  `ticket_validations` (nullable for now; `NOT NULL` lands in Phase 6).

**Role vocabulary v2** — platform and arena roles are now separate namespaces:

| Scope | Roles |
| --- | --- |
| PLATFORM | `PLATFORM_OWNER`, `PLATFORM_ADMIN`, `PLATFORM_SUPPORT` |
| ARENA | `ARENA_OWNER`, `ARENA_ADMIN`, `MANAGER`, `FINANCE`, `TICKET_AGENT`, `STAFF` |

`SUPER_ADMIN → PLATFORM_OWNER` and `ADMIN → ARENA_ADMIN` are renamed in place.
16 permissions were added: `staff.*` and the `platform.*` namespace.

**Backfill** (`0005_tenancy_backfill.sql`) — idempotent, no DELETE/DROP:
organization per arena, arena status from the old `is_active`, platform role
lifted onto `platform_role_id`, a membership for every user that had an arena
(a platform user operating an arena becomes its `ARENA_OWNER`), denormalised
`arena_id` derived from parent rows, and pre-tenancy rows attributed to the
single arena — but only when exactly one exists, so a multi-arena database
fails Phase 6's `NOT NULL` rather than being guessed at.

New permissions are granted conservatively: a role gains one only where it
already held the capability it replaces (`users.view → staff.view`,
`users.manage → staff.*`). Revoked permissions are never re-added, which would
be a silent privilege escalation. `PLATFORM_OWNER` is the exception — the roles
UI refuses to edit it, so it always holds the full set.

**Verification** — run against a copy of the real development database
(18 sessions, 142 bookings, 133 tickets, 142 payments, 151 customers):

- Migration applied clean; all row counts unchanged; no cross-tenant
  inconsistency between bookings/sessions, tickets/bookings, payments/bookings.
- Backfill re-applied a second time: no error, no change — idempotent.
- Restored from snapshot and re-run end to end after the permission fix.
- App boots, signs in as `PLATFORM_OWNER` with 41 permissions, serves all 18
  sessions and 151 customers; a `STAFF` login gets 4 permissions and is
  refused by `/api/admin/customers` with 403.
- 145 tests pass (135 baseline + 10 new), typecheck clean, lint unchanged.

`scripts/dev/tenancy-report.ts` prints the tenancy shape of any database and is
how the above was checked; it also runs against an unmigrated database.

**Deliberately deferred**

- `customers.arena_id` is *not* backfilled. Customers become arena-scoped in
  Phase 7, which also swaps the global unique email index for a per-arena one;
  doing half of it now would let two arenas contend for one address.
- `users.arena_id`, `users.role_id` and `arenas.is_active` are kept and still
  authoritative. Nothing reads memberships yet — that starts in Phase 4 and the
  old columns are dropped in Phase 7.
- The `role_key` enum type still exists, unused, and is dropped in a later
  migration so this one stays free of interactive rename prompts.

### Phase 3 record

**`server/tenant/` — the addressing layer.**

| File | Responsibility |
| --- | --- |
| `resolver.ts` | Hostname → arena. Pure enough to test: `normalizeHostname`, `subdomainOf`, `resolveTenantFromHost`. |
| `context.ts` | The tenant for the current request, memoised per request; status gating; page and route-handler variants. |
| `guards.ts` | `assertBelongsToArena`, `assertSameArena`, `assertArenaId` — the last application check before a row is used. |

**Resolution order.** A hostname resolves through: verified custom domain →
`{slug}.{root}` subdomain → dev-only slug override → sole-arena fallback.

The Host header is attacker-controlled, so it only ever *selects* a public
tenant and never proves access to one. Specific rules:

- `normalizeHostname` lowercases, strips port and trailing dot, and returns
  null for anything that is not a bare hostname (`evil.com/../admin`,
  `user@evil.com`, `a..b`), so a forged header can never reach a query.
- Only one label is read beneath the root, so `a.b.arenapass.com` is never
  interpreted as arena `a`.
- 18 reserved subdomains (`www`, `api`, `admin`, `app`, `cdn`, …) can never be
  an arena slug.
- A custom domain resolves only at `status = 'VERIFIED'` — an unverified row is
  a claim, not proof.
- A subdomain that matches no arena is a dead end. It does **not** fall through
  to the sole-arena rule, which would leak one arena on another's address.
- The sole-arena fallback applies only while the database holds exactly one
  arena. From the second arena on, an unrecognised host is refused.

**Status gating** is a separate decision from resolution, so admin surfaces can
reach an arena the public cannot:

| Arena status | Public storefront | Admin surface |
| --- | --- | --- |
| `ACTIVE` | served | served |
| `PENDING_SETUP` | 404 `ARENA_NOT_FOUND` | served (onboarding) |
| `SUSPENDED` | 503 `ARENA_UNAVAILABLE` | served |
| `ARCHIVED` | 404 | 404 |

`PENDING_SETUP` is deliberately indistinguishable from "no such arena": an
unlaunched tenant should not be discoverable by probing subdomains.

**Development.** `{slug}.localhost` works in the browser. For curl and tests
there is a slug override — `?__arena=<slug>` or an `x-arena-slug` header —
gated by `devOverrideAllowed()`, which is passed the production flag as an
argument so the rule itself is covered by a test rather than by reloading the
environment module.

**Wiring.** Every public surface now resolves its arena from the request
instead of calling `getDefaultArena()`: the storefront layout, homepage,
sessions list, about/FAQ/contact, the auth pages, `/api/sessions` and
`/api/cms/public`. `public-content.ts` takes an explicit `arenaId` and has no
notion of a "current" arena to fall back to. `getDefaultArena()` survives only
for the development seed and the pre-tenancy admin fallback, marked
`@deprecated`.

Two side-effects worth naming:

- Resolving the tenant reads request headers, which opts those routes out of
  static rendering — a tenant page can no longer be baked at build time and
  served to every host. `Vary: Host` was added to the two cacheable public
  endpoints.
- The storefront's document title came from the root layout's hard-coded
  `%s · Arena Pass`. A `generateMetadata` in the public layout now uses the
  arena's own name, so Lekki's storefront reads `Sessions · Lekki Football
  Arena` while the platform admin keeps platform branding.

**No proxy changes.** `proxy.ts` (Next.js 16's renamed middleware) stays a
cookie-presence redirect. The Next.js guide is explicit that proxy is not for
data fetching or authorization, and tenant resolution needs a database read —
so it happens server-side where the authoritative check already lives.

**Verification** — a second arena (`lekki`) was created in the development
database via `scripts/dev/create-test-arena.ts`, with one published session in
each arena:

| Request | Result |
| --- | --- |
| `Host: main.localhost` `/api/sessions` | only Arena Pass's session |
| `Host: lekki.localhost` `/api/sessions` | only Lekki's session |
| `Host: main.localhost` `/api/cms/public` | `arena=Arena Pass` |
| `Host: lekki.localhost` `/api/cms/public` | `arena=Lekki Football Arena` |
| `Host: evil.com` | 404 `ARENA_NOT_FOUND` |
| `Host: nosucharena.localhost` | 404 `ARENA_NOT_FOUND` |
| `Host: localhost` (two arenas, ambiguous) | 404 `ARENA_NOT_FOUND` |
| `/sessions` page per host | each renders only its own arena's session and name |

174 tests pass (166 → 174, 29 in the tenant suite), typecheck clean, lint
unchanged at 0 errors.

**Still open after this phase.** The admin surface is *not* yet tenant-safe:
`resolveArenaId(user)` still falls back to the default arena for any user
without `arena_id`, and no service consults `arena_memberships`. That is
Phase 4.

### Phase 4 record

**The choke point.** `server/tenant/authorization.ts` is now the only place
that answers "may this user do this, here?", and it recognises two grants that
are never interchangeable:

- an **arena** permission is held through an ACTIVE `arena_memberships` row;
- a **platform** permission is held through `users.platform_role_id`.

A platform role deliberately grants no access to any tenant's data. A platform
operator who must act inside an arena will do so through explicit, audited
impersonation (Phase 13); otherwise "platform admin" silently becomes "reads
every arena". Asking for a platform permission against an arena — or the
reverse — raises an internal error rather than failing quietly, because it is
a programming mistake, not a user one.

**The authenticated principal changed shape.** `AuthenticatedUser` no longer
has a `role` or a `permissions` list, because there is no single answer: it
carries `memberships[]` (one per arena, each with its own role and
permissions) and `platform`. Every consumer had to say *which arena* it meant,
which is the point.

**`resolveArenaId()` is gone.** Admin requests resolve their arena in this
order, in `server/tenant/admin-scope.ts`:

1. the arena the request is addressed to — and the caller must be a member of
   it, or the request is refused;
2. the arena they last selected, if the membership still exists;
3. their only membership;
4. otherwise `ARENA_SELECTION_REQUIRED`.

Step 1 is the one that matters. Serving Arena A's data on Arena B's address
because the caller happens to belong to A is exactly the confusion this layer
exists to prevent, and it is what the old default-arena fallback did.

**Two privilege-escalation holes found and closed.**

- `roles` is a single catalogue shared by every arena, so `roles.manage` —
  which the v2 default set granted to `ARENA_OWNER`, because it granted every
  arena permission — let one tenant's owner change what `MANAGER` means
  *inside every other tenant*. It is now `platform.roles.manage`, the roles
  screen and its API are platform surfaces, and `setRolePermissions` refuses
  to put a platform permission on an arena role or vice versa. Migration
  `0006_platform_role_catalogue.sql` revokes the old grants.
- A ticket was visible to any signed-in user holding `tickets.view`, whichever
  arena they held it in. It is now checked against *the ticket's own* arena.

**Staff management is now per-arena** (`server/services/users.ts`). A staff
member is an identity plus a membership, so:

- listing, updating and removing all act on the membership — an id belonging
  to another arena's staff reads as *not found*, not *forbidden*;
- removing someone ends their membership, not their account: they may still
  work for another arena, and deleting the user row would take that with it;
- suspending someone suspends them *here* and nowhere else;
- adding a person who already has an Arena Pass account reuses that identity
  and grants a second membership;
- an arena cannot lose its last owner, and only an owner may grant the owner
  role;
- platform roles are not assignable from an arena, so an arena owner cannot
  mint an Arena Pass operator.

`users.view` / `users.manage` were the single-arena names for this and are
retired in favour of `staff.*`; migration 0006 removes the dead grants.

**UI.** The admin shell resolves one arena and shows its name and slug in the
header, so an operator working for two arenas never has to guess which one
they are changing. The sidebar reflects the permissions of *that* membership.
Being refused renders a real screen — with only the arenas the viewer actually
belongs to — instead of escaping as a 500.

**Verification.** Two arenas, two operators, each a member of exactly one:

| Caller | Address | Result |
| --- | --- | --- |
| Arena A admin | A | 200, 19 sessions |
| Arena A admin | B — sessions, customers, staff, analytics, media, audit logs | 403 on every one |
| Arena B owner | B | 200, 1 session |
| Arena B owner | A — sessions, customers, payments | 403 on every one |
| A admin (platform owner) | role catalogue | 200 |
| B owner (no platform role) | role catalogue | 403 |
| A admin PATCHes a B staff member, on A's address | | 404 — the row does not exist here |
| A admin PATCHes a B staff member, on B's address | | 403 — not a member |
| Staff lists | per arena | A sees its 7, B sees its 1 |
| Admin shell | per arena | each shows its own name; cross-tenant shows the denial screen |

198 tests pass (174 → 198, 24 new in the authorization suite), typecheck clean,
lint unchanged at 0 errors.

**Still open after this phase.** Authorization is centralised, but the
*services behind it* are still arena-unscoped: `getBookingById(id)`,
`getCustomerDetail(id)`, `validateTicket(code)` and the rest still take a bare
id. An authorised caller is now always scoped to the right arena, so the
routes are safe today — but nothing stops the next handler from passing a
different id. Closing that is Phase 5, and Phase 6 makes it unrepresentable in
the database.

### Phase 5 record

**`server/db/scoped.ts`.** `forArena(arenaId)` returns a handle with `owns()`
(conditions, always anded with the arena) and `require()` / `find()` (one row
by id, within the arena). The point is to make the scoped query the *short*
one: `scope.owns(tickets, eq(tickets.id, id))` is less typing than assembling
the filter by hand, so forgetting it takes effort. `assertArenaId` refuses an
empty scope rather than letting `where arena_id = undefined` become an
unscoped read.

**Every tenant-facing service now takes the arena as its first argument.**
Sessions, bookings, payments, tickets, customers, media, CMS, notifications,
audit logs. The arena is part of the `WHERE`, not a check afterwards: another
arena's id matches no row, so a write is a no-op and a read is *not found* —
never *forbidden*, which would confirm the id exists.

**Four reads are deliberately not scoped**, each with the reason in the code:

| Function | Why |
| --- | --- |
| `verifyPaymentByReference` | The provider webhook and the reconcile cron have no tenant; the arena comes from the payment record the verified reference resolves to. |
| `expireStaleBookings`, `reconcilePendingPayments`, `syncSessionLifecycle` | Platform cron. They only move already-expired state and return no tenant data. |
| `getTicketByNumber` | Serves the public ticket link; the caller proves access with the signed key, the customer's own session, or staff permission *in the ticket's own arena*. |
| `resolveLocalFile` | Streams a file by its unguessable generated storage key. |

**A lint rule replaces discipline.** `app/**` may not import `@/server/db`:
routes and pages go through a service, which is where the arena filter lives. A
handler that opens the database itself is a query nobody reviewed for tenant
scope. Two files opt out (the health check, which has no tenant, and the
development mock-payment page); the waitlist route, which used to insert
directly, gained a `joinWaitlist` service instead.

**Customer identity had to move with it.** The scoped `upsertCustomerByEmail`
was incoherent against a *global* unique index on `lower(email)`: a person who
plays at Arena A could not book at Arena B at all — the insert failed. This is
not a problem the service layer can paper over, so migration
`0007_customers_per_arena.sql` was pulled forward from Phase 7:

- `customers.arena_id` backfilled from their bookings, then their tickets, then
  the sole arena — and left NULL rather than guessed when several arenas exist;
- `UNIQUE(lower(email))` → `UNIQUE(arena_id, lower(email))`, and the same for
  `username` and `google_sub`.

Customer sign-up, sign-in, password reset, Google sign-in and profile handles
are now resolved within the storefront's arena. The same person signing up at
two arenas gets two accounts, which is what the arenas expect: neither can see
the other's customer list, and neither can tell the address is in use
elsewhere.

**A bug the verification caught.** `generateTeamsAndSlots` wrote teams and
slots without an `arena_id`, so every session created after the 0005 backfill
left 8 teams and 32 slots unattributed. Fixed at the source and re-backfilled
by `0008_backfill_grid_arena.sql`.

**Verification.**

- 223 tests pass (198 → 223), typecheck clean, lint 0 errors.
- `tests/integration/cross-tenant-services.test.ts` populates Arena A fully
  (session, booking, payment, ticket, customer, media, four CMS kinds, a
  notification) and then attempts every read and write *from Arena B with
  Arena A's ids*: 25 cases, all refused, with Arena A's rows verified
  untouched afterwards. It also asserts Arena A still sees its own rows, so
  the filter is not simply matching nothing.
- A ticket valid in one arena scans as `INVALID` at another's gate, and the
  failed scan is logged against the arena that scanned it.
- Over HTTP with two arenas: main sees 19 sessions / 141 customers / 133
  tickets / 142 payments / 497 audit entries; lekki sees 1 / 0 / 0 / 0 / 3.
- The case that was broken now works: a customer whose email already exists in
  `main` booked successfully on `lekki` and got their own account there. Zero
  cross-tenant relationships between bookings, tickets, customers, sessions and
  slots.

**Open items for Phase 6.**

1. **Ten customers have no arena** in the development database — leftover e2e
   accounts with no bookings, created before a second arena existed. The
   migration refused to guess, by design. `NOT NULL` cannot be applied until
   they are attributed or removed.
2. `bookings.idempotency_key` is still **globally** unique. The service handles
   a cross-arena collision as a conflict rather than a replay, but the index
   should become `UNIQUE(arena_id, idempotency_key)`.
3. `GET /api/bookings/[id]` is now tenant-scoped but still has no ownership
   check — within an arena it relies on the booking id being an unguessable
   UUID. Guest checkout has no session to check against; a signed access key
   like the one tickets use is the fix, in the storefront phase.

### Phase 6 record

Up to here a cross-tenant row was prevented by application code. From here it
is **unrepresentable**.

**Composite foreign keys.** Every child of a tenant-owned row now carries
`(arena_id, <parent_id>)` and references the parent's `(arena_id, id)`, so the
database refuses the relationship rather than trusting the writer. Eight
tables gained a `(arena_id, id)` unique target; 22 composite keys were added:

| Child | References |
| --- | --- |
| `bookings` | session, customer, slot, team |
| `tickets` | booking, session, customer |
| `payments` | booking, customer |
| `transactions` | payment, ticket |
| `ticket_validations` | ticket, session |
| `teams`, `session_slots`, `waitlist_entries` | session (and slot → team) |
| `cms_services`, `announcements`, `banners` | media |

**`NOT NULL` on eleven tenant columns** — customers, teams, session_slots,
waitlist_entries, ticket_validations, media, cms_pages, cms_services, faqs,
announcements, banners — plus `arenas.organization_id`.

Two columns deliberately stay nullable, with the reason in the schema:
`audit_logs.arena_id` (changing the shared role catalogue is a platform action
belonging to no arena) and `notifications.arena_id` (platform notices). Every
query is an equality test, so such a row is invisible to every tenant rather
than visible to all of them. `system_settings.arena_id` keeps its documented
null-is-platform-default meaning.

**Uniqueness moved to where it belongs.** `bookings.idempotency_key` is now
unique per arena — two arenas choosing the same key is not a replay. Ticket
numbers, QR tokens, payment references and storage keys stay *globally* unique
on purpose: they are printed, scanned and quoted to a payment provider, where
a collision between arenas would be a real confusion rather than a tenancy
question.

**Indexes now lead with `arena_id`** on the paths that are always tenant-scoped
(bookings, tickets, payments, customers, media, CMS, audit logs, transactions).
Three keep their old shape because they are swept across arenas by cron and
would otherwise need a second index for no gain: `bookings_expires_idx`,
`payments_status_created_idx`, `notifications_status_idx`. Each says so.

**The ten unattributed customers** were attributed, not deleted — deleting is
irreversible and had not been confirmed. `scripts/dev/attribute-orphan-customers.ts`
prints what it would do, refuses to touch any customer that has ever booked,
refuses to run in production, and only writes with `--apply`. All ten were
created 15–17 September; the second arena was created on the 24th, so `main`
was the only possibility.

Worth noting: **a real deployment would never have hit this.** Replaying the
whole chain against the original single-arena database attributed all 151
customers automatically through 0007's sole-arena rule. The orphans existed
only because this working copy grew a second arena in Phase 3, before the
customer migration ran.

**A bug in the generated migration.** `drizzle-kit` emits every `ALTER TABLE …
ADD CONSTRAINT` before every `CREATE INDEX`, so the composite foreign keys ran
before the unique targets they reference and the migration failed on
`there is no unique constraint matching given keys for referenced table
"media"`. The statements are reordered in `0009_tenant_constraints.sql`:
targets, then everything else, then the keys.

**Verification.**

- Full chain replayed from the original pre-tenancy database: all 18 sessions,
  142 bookings, 133 tickets, 142 payments and 151 customers preserved, every
  tenant column populated, zero cross-tenant relationships.
- `tests/integration/tenant-constraints.test.ts` writes **directly to the
  database** — no service, no route, no authorisation — and asserts the storage
  layer refuses: a booking pointing at another arena's session, customer, slot
  or team; a ticket on another arena's booking, session or customer; a payment
  on another arena's booking or customer; a ledger entry against another
  arena's payment or ticket; a scan record against another arena's ticket or
  session; a team, slot or waiting-list entry on another arena's session; CMS
  content illustrated with another arena's media; a row with no arena at all;
  and an arena with no organization. It also asserts that moving an existing
  booking between arenas with a bare `UPDATE` is refused from both directions.
- 240 tests pass (223 → 240), typecheck clean, lint 0 errors.
- End to end over HTTP against the constrained schema: a session created in
  the second arena, then a full booking → payment → ticket (`AP-2026-000430`),
  with main at 18 sessions / 133 tickets / 151 customers and lekki at 1 / 1 / 1,
  and cross-tenant admin access still refused.

### Phase 7 record

The customer half of this phase was pulled forward into Phase 5, because
scoping the services was incoherent without it. What remained was the staff
side, email confirmation, and retiring the pre-tenancy columns.

**A customer session now belongs to one storefront.** `getCurrentCustomer()`
resolves the tenant and returns null when the account does not belong to it, so
a session from one arena is treated as signed out on another. Before this, the
reads were scoped — they would have seen no data — but the site would have
greeted them by name and offered them an account they do not have there. The
check lives in the session loader, so all twenty-odd consumers inherit it
without change.

**Email confirmation for customer accounts.** `email_verification_tokens`
mirrors the password-reset design: only the SHA-256 of the token is stored, one
live link at a time, claimed with a conditional UPDATE so two submissions
cannot both win. Deliberately a separate table rather than one table with a
`purpose` column — the two have different lifetimes and different
consequences, and keeping them apart means a bug in one cannot mint a token
for the other.

The token records the address it was issued for, so a link sent to an old
address cannot confirm a new one after the customer changes their email. The
link is consumed by a server component, so it works without JavaScript, and
the email carries the *arena's* name rather than the platform's. Issue and
delivery happen after the response, so signing up does not wait on SMTP.

Verification gates nothing yet: an unverified customer can still book. Making
it a precondition is a product decision for the storefront phase.

**Legacy identity columns dropped** — `users.arena_id`, `users.role_id`,
`arenas.is_active`, and the retired `role_key` enum type. Nothing had read them
since Phase 4. This is the one destructive step in the sequence, so
`0011_drop_legacy_identity.sql` opens with a check that refuses to run if any
active user would be left with neither an ACTIVE membership nor a platform
role: their access lives only in the columns about to be dropped, and dropping
them would lock that person out silently.

**Two things the drop exposed**, both fixed:

- `alertAdminsRefundRequired` found who to email by `users.role_id` and
  `users.arena_id` — the pre-tenancy shape, which also matched any user with a
  null arena. It now selects ACTIVE members *of the payment's arena* whose role
  there can issue refunds, so a refunder at another arena is never told about
  it.
- Sign-in and sign-out recorded their audit entry against `users.arena_id`. A
  staff identity can span arenas, so the event is now recorded against the
  storefront it happened on — null on the platform sign-in page, which belongs
  to no arena.

**Verification.**

- 251 tests pass (240 → 251), typecheck clean, lint 0 errors.
- `tests/integration/customer-identity.test.ts` drives the real sign-up and
  sign-in functions (with an in-memory cookie store, since they set a session
  cookie) and covers: a session resolving on its own arena and nowhere else; a
  deactivated account ceasing to resolve; the same person holding separate
  accounts *and separate passwords* at two arenas; and six confirmation cases —
  hash-only storage, unknown link, expired link, a link invalidated by an email
  change, single use, and no link issued for an already-confirmed account.
- Over HTTP: signing up on the second arena produced a link, confirming it
  returned `Email confirmed`, and replaying the same link was refused. One
  customer session presented on two storefronts read as *signed in* on its own
  and *signed out* on the other.
- Admin sign-in still works with the columns gone, returning memberships and
  platform standing, with 18 sessions on its own arena and `FORBIDDEN` on the
  other.

**Known gap.** Staff accounts have an `email_verified_at` column and no flow to
set it. Staff arrive by invitation from an arena owner, so confirmation belongs
with the invitation flow in the admin phase rather than bolted on here.

### Phase 8 record

**Each arena is paid into its own account.** `arena_payment_accounts` — added
in Phase 2, unused until now — holds one provider account per arena.
`resolvePaymentAccount(arenaId)` finds it, and `getPaymentProviderForArena`
builds the client from *those* credentials, so initialize, verify and refund
all speak to the arena's own provider account.

The fallback rule is the part that matters. The platform's environment
credentials remain, but only where they cannot mean "one tenant's customers
paid into another tenant's account": under the mock provider, or while the
deployment has exactly one arena. Past that, an arena with no account of its
own **cannot take payments at all** — a clear error its owner can fix, rather
than a silent misdirection of funds. This mirrors the tenant resolver's
sole-arena rule.

**Credentials are encrypted at rest.** `server/crypto.ts` does AES-256-GCM with
a random IV per value, stored as `v1.<iv>.<tag>.<ciphertext>`. GCM means a
tampered row fails to decrypt rather than silently yielding different bytes, so
an edited record cannot redirect a tenant's money. The key comes from
`CREDENTIALS_KEY`, separate from `SESSION_SECRET` so it can be rotated on its
own schedule, falling back to it outside production.

Secrets are write-only through the API: the settings endpoint reports whether a
key is stored, never what it is, and omitting a secret on edit leaves the
stored one untouched. The audit entry records a *masked* key, which identifies
which credential is in use without storing it.

**The webhook was rewritten around an event store.** `payment_events` records
every delivery before it is acted on, keyed by a fingerprint of the provider,
the signature and the raw body. The order is now:

1. claim the delivery against its fingerprint — a replay, whether the
   provider's own retry or a captured request resent by someone else, collides
   with the stored row and is acknowledged without being processed again;
2. read the reference and find which arena it belongs to, using an unguessable
   reference as a *lookup* and trusting nothing in the body;
3. verify the signature with **that arena's** signing secret;
4. only then act, re-reading the amount from our own record.

An unknown reference is acknowledged without any signature check, so it cannot
be used to probe which arenas exist or which keys are configured. A bad
signature is recorded and refused. The payload is stored only after the
signature proved the provider sent it.

**An explicit payment state machine** (`server/payments/state.ts`) replaces
scattered string comparisons. `PAID` can only become `REFUNDED`; a late
"failed" event for a paid reference is now a rejected transition rather than a
record that quietly contradicts the ticket in the customer's hand. `FAILED →
PAID` is allowed, because a provider does sometimes confirm an attempt we had
given up on, and every status may repeat, because providers retry.

**Verification.**

- 272 tests pass (251 → 272), typecheck clean, lint 0 errors.
- Encryption: round-trip, a different ciphertext each time so equal keys are
  not detectable, a tampered ciphertext throwing rather than returning wrong
  bytes, and masking.
- Accounts: a stored secret is never returned by the API or contained in the
  audit metadata; editing the public key keeps the secret; another arena
  cannot list or delete it; each arena resolves to *its own* key; a non-ACTIVE
  account is not used; and an arena with no account is refused under a real
  provider.
- Webhooks: unknown reference acknowledged with no signature check; bad
  signature recorded and refused; a signed event with nothing to verify
  acknowledged; and the same signed bytes delivered three times producing one
  event row and exactly one ticket.
- Over HTTP: the second arena connected a Paystack account through the admin
  API; the response and the listing contain no secret; the stored column reads
  `v1.xLZ5YPkv8j1EguxI…` with zero rows containing the plaintext; the first
  arena is refused (403) when reading the second's accounts; and a booking
  still completes to a ticket.

**Deliberately unchanged.** Amounts were already server-authoritative — the
charge is built from the session's own price and the provider's reported amount
must match exactly — so that requirement needed no work. Paystack's raw-body
handling and signature check were already correct; what they lacked was a
per-arena key and replay protection.

**Known limitation.** One webhook URL serves every arena, and the arena is
found from the payment reference. That is correct for Paystack, which posts to
a single configured endpoint per account, but a provider that signs with a
per-account key *and* gives no usable reference would need a per-arena webhook
path. The event store makes that a routing change, not a redesign.

### Phase 9 record

Much of what this phase asks for was already right: the QR payload was an
opaque random token plus an HMAC, verified before any database hit, and
admission was a conditional `UPDATE … WHERE status = 'CONFIRMED'`, which is
already atomic. Four things were not.

**Each arena signs with its own derived key.** The signing key is now
`hmac(QR_SECRET, "qr:" + arenaId)`, so a code minted for one arena fails the
signature check at another's gate — before any lookup, rather than after one
that happens to return nothing. The payload itself is unchanged in shape and
still carries nothing identifying: no ticket number, no customer, no session,
and not the arena id either. This is domain separation, not secrecy.

**The scan log was storing a live credential.** `ticket_validations.scanned_value`
held whatever was scanned, in full. For a ticket that had not yet been used,
that is a working QR payload: anyone able to read the table could walk in on
someone else's ticket. Rows now store a recognisable fragment (`AP1.…K2PX`, or
a plain ticket number whole, since that is not a credential) plus a SHA-256
fingerprint, so repeated forgeries can still be correlated without keeping
anything usable. Migration `0013` redacts the rows already there — verified as
zero remaining full payloads.

**A `reason` on every scan.** The gate now records *why* a scan ended as it
did — already admitted and when, wrong session, cancelled, expired, not a
ticket for this arena — rather than leaving staff to infer it from a result
code.

**A ticket state machine** (`server/services/ticket-state.ts`), the same shape
as the payment one. `USED` can only become `REFUNDED`: someone already inside
is never un-admitted, whatever arrives later. A ticket's own `expires_at` is
now checked as well as the session window, which the validation chain had been
skipping entirely.

The full chain a scan goes through: format → signature *with this arena's key*
→ existence within this arena → session match → status → session cancelled →
ticket expiry → session ended → atomic admission.

**Verification.**

- 286 tests pass (272 → 286), typecheck clean, lint 0 errors.
- The QR payload asserted to contain none of the ticket number, customer id,
  session id or arena id; a code for one arena returning null at another's
  gate; tampered token, tampered signature and wrong prefix all rejected.
- Three simultaneous admissions of the same code produce exactly one `VALID`,
  two `ALREADY_USED`, and exactly one `ADMITTED` row in the scan log.
- The stored scan value asserted to be unusable: it does not contain the
  token, and feeding it back through `parseQrPayload` returns null.
- Over HTTP, on a freshly issued ticket: `check` → VALID (not admitted),
  `admit` → VALID, `admit` again → ALREADY_USED, and the same ticket number at
  the other arena's gate → INVALID.
- The whole migration chain replayed from the original pre-tenancy database:
  18 sessions, 142 bookings, 133 tickets, 142 payments, 151 customers intact,
  no cross-tenant relationships.

**A note on the replay.** Migration 0013 first tried to backfill fingerprints
with `digest()`, which needs pgcrypto — not present in the embedded
development database — and the failure left that database unusable. Restoring
the snapshot and replaying the chain was the fix, and it is the reason a
pre-migration snapshot is worth keeping. The migration now redacts without
hashing, and the fingerprint applies to new scans only.

### Phase 10 record

The data side of this phase was already done — CMS, media, notifications and
analytics were all scoped in Phase 5. What remained was what those services
*serve*.

**CMS content was already safe from XSS**, and it is worth saying why rather
than adding a sanitiser for appearance: the content is structured JSON
rendered as text through JSX, and there is no `dangerouslySetInnerHTML`
anywhere near it. React escapes it. A sanitiser would be a second, weaker
guarantee layered on a working one. If rich text is ever introduced, that
changes, and the check belongs at that point.

**Uploaded SVGs were a stored-XSS vector.** An SVG is a document, not a
picture: it can carry scripts, event handlers, external references and
embedded frames. Served from the arena's own origin — where its admins and
customers are signed in — that is session theft, reachable by anyone with
`media.manage` or a compromised staff account. The previous check looked for
`<script` and nothing else.

Suspicious files are now **rejected, not cleaned**. A sanitiser is a list of
things someone thought of; every few years the browser adds another, and the
operator who needs a logo can upload a PNG. `inspectSvg` refuses scripts,
executable and embedding elements, `on…=` handlers, `javascript:` URLs,
embedded HTML, external references, and entity or DTD declarations. On top of
that the file route serves every upload with
`default-src 'none'; style-src 'unsafe-inline'; sandbox`, `nosniff` and
`X-Frame-Options: DENY`, so an SVG that somehow slipped past can still neither
run script nor reach the network.

**Branding is now the arena's, everywhere a customer looks.** The storefront
takes its colours from the arena's own `brand_primary_color` /
`brand_accent_color` and its mark from `logo_media_id`, resolved through the
arena-scoped media service so a stale or hostile reference simply yields no
logo. Colours are restricted to `#rgb` / `#rrggbb` before they reach a CSS
custom property — the value would otherwise be able to end the declaration and
start another.

Seven components rendered a hard-coded `AP` monogram on tenant-facing
surfaces: the navbar, both footers, the customer shell in two places, the
digital ticket and the auth shell. They now use the arena's logo, or its
initials. Lekki's storefront reads `LF`.

**Two branding leaks in email and metadata.** The password-reset email was
sent as "Arena Pass" to customers of every arena; it now carries the arena's
own name, as the payment and ticket emails already did. And the storefront's
document title was being wrapped by the root layout's `%s · Arena Pass`
template — `title.absolute` (checked against this Next version's own metadata
documentation) stops that, so the homepage now reads `Lekki Football Arena`
rather than `Lekki Football Arena · Arena Pass`.

**Verification.**

- 295 tests pass (286 → 295), typecheck clean, lint 0 errors.
- Nine SVG attacks rejected by name — inline script, event handler, error
  handler, animated handler, `javascript:` URL, embedded HTML, external
  reference, embedded frame, entity declaration — and a plain drawing
  accepted.
- An upload named `../../etc/passwd.svg` is stored under a generated name
  beneath the arena's own prefix, with the original name kept only as a label.
- Branding asserted per arena: one arena's colours and logo, the other's
  defaults; a colour that is not plain hex dropped (including
  `red;} body{display:none` and `#16a34a;--x:y`); and a logo belonging to
  another arena yielding nothing.
- Over HTTP: a hostile SVG refused with *"This SVG contains an event handler
  attribute"*; a clean one accepted and served with the locked-down headers;
  the two storefronts rendering `AP` and `LF` respectively, with titles
  `Arena Pass` and `Lekki Football Arena`.

### Phase 11 record

The storefront itself was finished in Phases 3 and 10 — tenant resolution,
per-arena content, branding and titles. This phase was the caching question
the audit called the most dangerous leak once hostnames map to tenants: a
response served to the wrong host is the one failure where the application is
never involved, because the request never reaches it.

**The production build answers it directly.** `next build` prints what it
prerendered, and the only static entry is `/_not-found`. Every page and every
route handler is `ƒ` — server-rendered on demand. That is not a convention
anyone has to remember: resolving the tenant reads request headers, which
makes the route dynamic by construction. A tenant page cannot be baked at
build time and handed to every host because there is nothing to bake.

**Two endpoints are deliberately cacheable**, and both now name every input
that can select a tenant: `Vary: Host, X-Arena-Slug`. Shared caches key on the
host already; saying so explicitly means one that does not still cannot serve
Arena A's branding on Arena B's address. The second value covers the
development slug override, which is refused in production but would otherwise
be a response-changing input absent from the key.

**Failures are no longer cacheable at all.** `fail()` now sets
`private, no-store` on every error envelope unless a route asked for something
else. A denial depends on who asked, which arena they asked about, and whether
they were signed in; a stored 403 is a confusing thing to serve back to
somebody who would now be allowed.

**Private pages.** `next.config.mjs` marks `/account`, `/admin`, `/tickets` and
`/checkout` as `private, no-store`. The header lands on responses Next does not
render itself — redirects, for instance — but the page renderer sets its own
`Cache-Control: no-cache, must-revalidate` afterwards and wins. That is
acceptable rather than ideal, and the reason it is acceptable is specific:
those responses carry **no validator**. With no `ETag` and no `Last-Modified`,
a shared cache under `no-cache` has nothing to revalidate against, so it cannot
reuse a stored copy for a second visitor. The config rules stay, because they
are the documented mechanism and they apply wherever the renderer does not
overwrite them.

**Not verified here:** production *runtime* headers. The app refuses to start
in production mode without a managed database and blob storage, by design, so
only the build output could be checked in this environment. The route table is
the stronger of the two signals, but a deployment should confirm the rendered
`Cache-Control` on `/account` once it is running behind its real CDN.

**Verification.**

- 301 tests pass (295 → 301), typecheck clean, lint 0 errors.
- The production build completes and prerenders exactly one route, which is
  the 404 page.
- `tests/integration/cache-safety.test.ts` runs the real route handlers and
  asserts: the cacheable endpoints declare `public` with `Host` and
  `X-Arena-Slug` in `Vary`; a customer's own data and a booking are
  `no-store`; an unrecognised host gets `ARENA_NOT_FOUND` and that refusal is
  itself uncacheable; and the same URL with two different hosts returns two
  different arenas — which is the whole reason the cache key cannot be the URL
  alone.

**Carried forward to Phase 15.** Rate limiting is still keyed by IP alone for
sign-in, where booking, signup and the waiting list are already keyed per
arena. On a shared address one busy tenant can currently exhaust another
tenant's sign-in allowance.

### Phase 12 record

Until this phase an arena could only be created by a development script.
Everything underneath was multi-tenant; there was no front door.

**Registration creates a tenant in one transaction.** An identity, an
organization, an arena, the membership that ties them, the default CMS pages
and the site name — all or nothing. A half-made tenant is worse than none: an
organization with no arena is invisible, and an arena with no owner is
unreachable.

Two decisions inside it are worth naming:

- The arena is created `PENDING_SETUP`, so its storefront is **not** served
  until its owner launches it. A half-configured arena that cannot take
  payment should not be taking bookings.
- An email that already belongs to an Arena Pass account opens a second arena
  under that same identity, and **the password in the form is ignored**.
  Otherwise knowing somebody's address would be a way to overwrite their
  credentials.

**Setup is a checklist, computed from what exists** rather than from a stored
cursor. An owner who creates a session from the sessions screen finds that
step already ticked; one who leaves halfway comes back to exactly what is
left. Connecting payments and creating a first session are required; branding
and inviting staff are not.

`launchArena` refuses while a required step is outstanding, and says which —
*"Finish these first: Connect payments, Create your first session"*. The button
is disabled too, but that is a courtesy: the server is what refuses.

**The arena switcher** is built from the operator's memberships, so an arena
they have no part in cannot appear in it, and it renders as plain text rather
than a menu for the vast majority who belong to one arena. The selection is
validated against membership when it is set *and* again on every read, so a
tampered cookie selects nothing rather than something.

**A routing bug the verification caught.** `/start` first lived under
`(public)`, whose layout resolves an arena from the hostname — so the
registration page 404'd on the platform's own address, where no arena exists.
Signing up is precisely the moment there is no tenant. It now lives in a
`(platform)` route group that does not resolve one.

**Verification.**

- 312 tests pass (301 → 312), typecheck clean, lint 0 errors.
- Registration asserted to create all four records together, with the arena
  `PENDING_SETUP` and the owner holding `ARENA_OWNER`; a duplicate address
  refused; reserved and malformed addresses (`www`, `api`, `Lekki Arena`,
  `-lekki`, 41 characters) rejected by the schema; and a second arena for an
  existing operator leaving their password hash **byte-identical**.
- The checklist asserted to start at 0%, to count a session created outside
  the wizard, to ignore a payment account that is `PENDING` rather than
  `ACTIVE`, to refuse launch until both required steps are done, to be
  idempotent once launched, and not to leak one arena's progress into
  another's.
- Over HTTP, a complete run: registered *Ikorodu Arena* → storefront 404 while
  admin 200 → launch refused naming the two outstanding steps → connected
  payments and created a session → 100% → launched → storefront 200 serving
  *Opening Night*. Registering a second arena for the same operator made the
  switcher appear, showing *Ikorodu Arena*; the single-arena admin has no
  switcher at all.

### Phase 13 record

**Billing is a separate financial domain**, and the schema says so. `plans`,
`subscriptions`, `subscription_events` and `usage_records` describe what an
*organization* pays Arena Pass; `payments` and `transactions` describe what an
arena's *customers* pay the arena. Different tables, different status
vocabulary (`TRIALING / ACTIVE / PAST_DUE / CANCELLED / EXPIRED`), no shared
code path — so a bug in football ticketing cannot touch a subscription, and a
failed subscription charge can never look like a failed booking.

**The platform control centre** is its own shell at `/platform`, deliberately
unlike the arena dashboard — amber chrome, its own navigation, its own
"Leave platform" link — so an operator always knows which side of the line
they are standing on. It is reachable only with a `platform.*` permission,
which an arena role can never hold; an arena owner who opens it is redirected
to their own dashboard.

Suspending an arena closes its storefront immediately while leaving its
operators their admin access, so they can fix whatever caused it. An arena
still in setup cannot be switched live from here — launching is its owner's
decision.

**Feature flags are per arena**, with a platform default and an optional
per-arena override, read on the server through `isFeatureEnabled`. A flag can
be turned on for one arena without touching another, and a default-on
capability can be turned off for a single tenant.

**Impersonation is the only way across the line**, and it is deliberately
awkward:

- it requires `platform.impersonate`, which no arena role can hold;
- it requires a written reason, which is stored and audited;
- it grants **read-only** access — every permission ending in `.view` and
  nothing else — so support can diagnose without changing a tenant's arena;
- it reaches exactly one arena, not all of them;
- it expires after 30 minutes, as a query condition rather than a sweep, so an
  expired session stops working without anything having to run;
- only one can be open at a time, so the audit trail is never ambiguous;
- it never weakens a real membership: a platform owner who genuinely owns an
  arena keeps their owner access there.

A banner sits above every admin page while it lasts, naming the arena, saying
read-only, counting down the minutes and offering a way out. An operator who
forgets they are inside somebody else's arena is how a support session becomes
an incident.

**Verification.**

- 327 tests pass (312 → 327), typecheck clean, lint 0 errors.
- Platform reach: every arena listed regardless of membership; suspending
  closes the storefront (`ARENA_UNAVAILABLE`) but not the admin; the reason is
  in the audit trail; an unfinished arena cannot be forced live.
- Flags: default until overridden, on for one arena and off for another, and a
  default-on feature disabled for a single tenant.
- Impersonation: nothing granted before it starts; a reason under five
  characters refused; read permitted and *five* different mutations refused;
  no other arena reachable meanwhile; expiry observed without a sweep; a
  second start closing the first; and a real membership left at
  `ARENA_OWNER` rather than downgraded.
- Over HTTP: an arena owner gets 403 from the platform API and a redirect from
  `/platform`; the platform owner reads a tenant's sessions only while
  impersonating (403 → 200 → 403 after stopping), cannot create a session
  there, and sees *"You are viewing Surulere Arena as platform support.
  Read-only, and it ends in 30 minutes."*

**An incident, and what it cost.** Fetching an arena id with a `tsx` script
while the dev server was running corrupted the embedded database — PGlite
allows one process at a time, and the second attachment leaves it unopenable.
It looked like it worked, and the failure surfaced later as unrelated 500s,
which is what made an early banner check report a false negative. The database
was restored from the pre-migration snapshot and the chain replayed; the
verification above was then redone over HTTP alone, taking the arena id from
the registration response instead.

### Phase 14 record

Most of the cross-tenant matrix was written during the phases that introduced
each surface, which is deliberate — a test written next to the code it guards
is a test someone maintains. This phase filled the three gaps that only make
sense once everything else exists.

**The development seed now builds two complete arenas.** Tenant isolation is
not something you can see in a database with one tenant in it. Arena B is
created through `registerArena` — the same service the public sign-up form
calls — then launched through `launchArena`, so seeding exercises the real
onboarding path rather than inserting rows behind it. Each arena gets its own
owner, one account per role, its own customers, pitches, prices, branding and
content.

One customer address, `ada.shared@example.com`, deliberately exists in both.
That case used to be impossible; now each arena holds a separate account for
that person and neither can see the other's.

**An invariant suite** (`tests/integration/invariants.test.ts`) drives both
arenas through the real booking, payment and admission paths *at the same
time*, then checks properties of the whole database as queries that must
return no rows. A test of one function can pass while the system is wrong;
these hold whichever code path produced the rows:

- every tenant-owned row has an arena, and no two related rows disagree about
  which one — across bookings, tickets, payments, transactions, slots and
  scans;
- no session exceeds its declared capacity, the slot grid matches that
  capacity exactly, no slot is allocated twice, and the `booked_count` counter
  agrees with the bookings themselves;
- exactly one ticket per confirmed booking, every issued ticket backed by a
  PAID payment, every amount equal to the session's own price, and no negative
  money anywhere;
- no ticket admitted twice, every admitted ticket marked used with a
  timestamp, and no usable QR payload left in the scan log;
- every arena has an active owner, no arena role carries a platform
  permission, no `platform_role_id` points at an arena role, one membership per
  person per arena, and customer email unique within an arena but free across
  them.

**Concurrency at capacity**, raised to the specified figure: 100 simultaneous
bookings against 32 slots yield exactly 32 successes, 68 `SESSION_FULL`, 32
distinct team/slot positions and no counter drift. A new case runs 80
interleaved attempts across *two* arenas at once and asserts each fills to its
own 32 with no slot claimed across the boundary.

**A bug the invariants caught, in the tests themselves.** The `makeArena`
fixture created arenas with no owner — a state `registerArena` never produces
and `removeStaff` actively prevents. The invariant was right and the fixture
was unrealistic, so the fixture now creates an owner, which makes every test's
world closer to a real one.

**A packaging bug the seed caught.** `server/tenant/context.ts` imported
`next/navigation` for two page helpers, and the session loader imports that
module — so the seed script, which runs outside Next, died on
`React.createContext is not a function`. The page helpers moved to
`server/tenant/page.ts`; the context module is now loadable anywhere.

**Verification.**

- 346 tests pass (327 → 346), typecheck clean, lint 0 errors.
- The seed runs from an empty database and produces two launched arenas with
  distinct branding (`#22c55e` and `#f97316`), distinct customers
  (`player137@example.com` vs `player137@lekki.example.com`), distinct pitches
  (`Main Pitch` vs `Lekki Pitch 1`) and distinct staff domains.
- `ada.shared@example.com` resolves to customer `9cfec313…` in one arena and
  `939c8d5c…` in the other.
- The full role matrix over HTTP, signed in as each seeded account:

  | Role | Own arena | Other arena |
  | --- | --- | --- |
  | Owner | 200 | 403 on sessions, customers, tickets, payments, staff |
  | Arena admin | 200 | 403 on all five |
  | Manager | 200 | 403 on all five |
  | Finance | 403 on sessions — the role has no `sessions.view` | 403 on all five |
  | Ticket agent | 200; 403 to validate, which that role cannot do | 403 on all five |
  | Staff | 200; 200 to validate | 403 |

  Two of those are role-correct refusals inside the operator's *own* arena,
  which is the point of the matrix: it distinguishes "wrong tenant" from
  "wrong role".

**Noted during the run.** Signing in as six accounts in quick succession hit
the login rate limiter, which is keyed by IP alone — the same gap already
carried forward to Phase 15, now seen from the other side: it is not only a
cross-tenant fairness problem, it makes multi-account testing awkward.

### Phase 15 record

**Rate limits are keyed per arena.** `scopedKey(arenaId, identifier)` is now
used on sign-in, sign-up, password reset, email verification, Google sign-in,
booking and the waiting list. Before this, every tenant shared one bucket per
IP — a busy arena, or one under attack, exhausted the sign-in allowance of
everyone else behind the same address, which on a mobile network is a great
many unrelated people. Requests belonging to no arena share a `platform`
bucket.

**A Content Security Policy written for this application**, not copied. The
proxy issues a fresh nonce per request; `script-src` is
`'self' 'nonce-…' 'strict-dynamic'` with no `unsafe-inline`, plus
`'unsafe-eval'` in development only, which is what React needs for its
debugging output. Fonts are self-hosted by `next/font` at build time, so there
is no font origin; QR codes are `data:` URIs, hence `img-src data:`; Google
sign-in is a top-level redirect and the payment provider hosts its own
checkout, so neither needs a `connect-src` or `frame-src` entry.

`style-src` keeps `unsafe-inline` deliberately and says so in the code: the
design system and the per-arena theme both emit inline styles, and an inline
style cannot execute script. Scripts get no such exemption.

Two inline scripts needed the nonce threaded to them — the phone-zoom shim and
`next-themes`' anti-flash script. All 27 script tags on a rendered page now
carry it; the stored-upload route keeps its own far stricter
`default-src 'none'; sandbox`.

**Documentation.** `MULTI_TENANCY.md` explains the five layers and opens with
the one-paragraph answer a reviewing engineer needs. `THREAT_MODEL.md` records
assets, actors, trust boundaries, eleven threats with their controls, and
seven residual risks stated plainly. `BILLING.md` sets out the two financial
domains and what is deliberately not built. `OPERATIONS.md` covers migrations,
backups, what to watch, secret rotation and incident response — including the
PGlite single-process constraint that cost two database restores during this
work. `SECURITY.md` gained a multi-tenant controls table; `ARCHITECTURE.md`
and `DATABASE.md` point at `MULTI_TENANCY.md`.

**The final adversarial audit.** Against the two-arena seed, signed in as each
of Arena A's six roles, fourteen operations were attempted on Arena B: reading
sessions, customers, tickets, payments, staff, analytics, audit logs and media;
creating a session; inviting staff; editing CMS; changing settings; validating
a ticket; and reading payment credentials.

**Every one refused, for every role.** Arena B's site name was unchanged
afterwards. From the customer side: booking Arena B's session from Arena A's
storefront is `SESSION_NOT_FOUND`, reading it is 404, an unknown host is 404,
and a Host header carrying path traversal is 404.

Two rows in the first run needed honest follow-up rather than being reported as
passes:

- `change settings` returned **405**, because the probe used `PUT` where the
  route takes `PATCH`. Re-run correctly, it is 403 for every role.
- `platform control` returned **200** for the owner account — correct, because
  that account *is* the platform owner; every other role got 403. But it also
  revealed that the feature-flag service returned an empty list for an arena
  that does not exist. Fixed to 404, with a test.

**Verification.**

- 347 tests pass (346 → 347), typecheck clean, production build compiles.
- Lint finished at **0 errors, 4 warnings**, but only after a correction: the
  first reading of the output was wrong. The summary line
  “0 errors and 1 warning potentially fixable with `--fix`” counts *fixable*
  problems, not total ones, and there was in fact one real error — the
  impersonation banner called `Date.now()` during render, which React forbids
  because a re-render would silently change the number. It now reads the clock
  in an effect and counts down, which is what a “this ends soon” banner should
  have done anyway. A stale `eslint-disable` was removed at the same time.
  The four remaining warnings are three vendored shadcn/ui primitives and one
  deliberate full-page reload after a failed booking; none were introduced by
  this work and none are rewritten merely to silence a warning.
- The production build reports **126 routes, all `ƒ` (server-rendered on
  demand), and zero prerendered**. Nothing tenant-shaped can be baked into a
  static file at build time, because at build time there is no host to resolve
  a tenant from. This is the structural half of cache safety; the headers are
  the other half.
- The CSP was confirmed on rendered pages, with every script tag nonced and
  the storefront, sessions list, admin sign-in and platform registration pages
  all still rendering.
- Logging was audited for secrets: no password, token, key or authorization
  header is logged anywhere.
