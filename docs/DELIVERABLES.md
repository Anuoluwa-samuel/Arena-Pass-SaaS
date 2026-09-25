# Deliverables

The transformation is complete: 16 phases, recorded phase by phase in
[TRANSFORMATION_PLAN.md](TRANSFORMATION_PLAN.md). This document is the summary
the specification asks for, with a pointer to the document that holds the full
version of each item.

---

## How Arena A is isolated from Arena B

Every request that touches tenant data carries an `arenaId` that the **server**
derived — from the hostname, never from anything the client asked for. That id
is then checked at five independent layers, each of which would stop a breach
on its own:

1. **Addressing.** `resolveTenantFromHost()` turns the request's host into one
   arena: a verified custom domain, else a single-label subdomain of
   `APP_ROOT_DOMAIN`, else (development only) an explicit override, else the
   sole arena if only one exists. An unknown host is a 404. There is no
   `?arenaId=` parameter and no `X-Arena-Id` header anywhere in the
   application.

2. **Authorisation.** `authorizeArena(user, arenaId, permission)` is the only
   function that grants access to an arena, and it is satisfied only by an
   ACTIVE `arena_memberships` row for *that* arena carrying *that* permission.
   Not by an email address, not by a URL slug, not by a request body, and not
   by a platform role — platform roles are a disjoint permission set that
   deliberately grants no tenant access at all.

3. **Services.** Every service function takes `arenaId` as its first parameter
   and reads through `forArena(arenaId)`, which adds `arena_id = ?` to the
   `WHERE` clause. A cross-tenant read returns **not found**, never
   "forbidden", so the API cannot be used to discover what exists elsewhere.

4. **The database.** `arena_id` is `NOT NULL` on every tenant table. Composite
   foreign keys `(arena_id, id)` mean a child row cannot reference a parent in
   another arena — the database refuses it even if every line of application
   code above were wrong. Uniqueness that should be per tenant (customer email,
   session slug, ticket number) is per tenant.

5. **Everything around the request.** Per-arena payment credentials, per-arena
   QR signing keys, per-arena rate-limit buckets, per-arena storage prefixes,
   arena id on every audit and log line, and no page prerendered at build time
   — the production build reports 126 routes, all server-rendered on demand,
   so nothing tenant-shaped can be baked into a shared static file.

Full version: **[MULTI_TENANCY.md](MULTI_TENANCY.md)**.

---

## 1. Architecture

Organization → Arena → everything. The **arena is the tenant boundary**: one
venue, one storefront hostname, one staff roster, one set of customers, one
payment account. Organizations group arenas under shared ownership for billing;
they grant no data access of their own.

Single Next.js 16 application, single shared PostgreSQL database, row-level
tenancy by `arena_id`. Chosen over schema-per-tenant or database-per-tenant
because the operational cost of migrating hundreds of schemas dwarfs the safety
it would buy once composite foreign keys are in place — and the failure modes
of a forgotten migration are worse than the failure mode this design guards
against with constraints. → [ARCHITECTURE.md](ARCHITECTURE.md)

## 2. Schema

38 tables. Added by this work: `organizations`, `arenas`, `arena_domains`,
`arena_memberships`, `arena_payment_accounts`, `email_verification_tokens`,
`payment_events`, `plans`, `subscriptions`, `subscription_events`,
`usage_records`, `feature_flags`, `arena_feature_flags`, `impersonations`.
Every pre-existing tenant table gained `arena_id NOT NULL`, a composite unique
`(arena_id, id)`, and composite foreign keys to its parents.
→ [DATABASE.md](DATABASE.md)

## 3. Migration strategy

15 forward-only SQL migrations, `0004`–`0014` added here, each reviewed before
it ran. The sequence was deliberately: add nullable column → backfill →
enforce `NOT NULL` → add constraints. No destructive migration was run; no
table or column was dropped except the two legacy identity columns in `0011`,
after their data had been moved and verified.

Every migration was tested against a copy of the real development database (18
sessions, 142 bookings, 133 tickets, 142 payments, 151 customers). All of it
survived the full chain. A pre-migration snapshot was kept throughout and used
three times to recover from mistakes made during development.
→ [OPERATIONS.md](OPERATIONS.md)

## 4. Tenant resolution

Hostname only, resolved server-side, in this order: verified custom domain →
single-label subdomain of `APP_ROOT_DOMAIN` → development override
(`?__arena=` or `x-arena-slug`, refused when `NODE_ENV=production`) → the sole
arena if exactly one exists. Reserved subdomains (`www`, `admin`, `api`, `app`,
…) cannot be claimed. Unknown host → 404, which also means a Host header
carrying path traversal is a 404 rather than an error page.

The root domain itself belongs to no arena: at `/` it serves the platform's
welcome and sign-up pages, and every other path there is a 404.
→ [MULTI_TENANCY.md](MULTI_TENANCY.md)

## 5. RBAC

Two disjoint permission scopes. **Arena** permissions come only from an ACTIVE
membership; **platform** permissions come only from `users.platform_role_id`.
Neither satisfies the other, and asking for one in the other's checker is a
programming error that throws rather than failing open. Roles map to
permissions in `role_permissions`, editable within scope.

A platform operator who needs to see inside a tenant does so through
**impersonation**: read-only (only `*.view` permissions), 30-minute maximum,
banner on every screen, row in `impersonations`, audit entry at start and end.
→ [SECURITY.md](SECURITY.md)

## 6. Authentication

Staff and customers are separate principals with separate tables, cookies and
lifetimes (12 hours / 30 days). Customers are scoped per arena — the same
person at two arenas is two rows, and neither arena learns of the other.
Sessions are database rows with only the token's SHA-256 stored. scrypt
passwords. Single-use, arena-scoped, hashed reset (30 min) and verification
(24 h) tokens. Google sign-in with PKCE, state, nonce and full claim
validation. → [AUTH.md](AUTH.md)

## 7. Payments

Each arena is paid into **its own** provider account; secrets are encrypted at
rest with AES-256-GCM. If an arena has no account and more than one arena
exists, payment is **refused** rather than falling back to the platform's keys —
the fallback exists only for the original single-arena deployment. Amounts are
integers in minor units, read from the booking; no request schema accepts an
amount. Webhooks are fingerprint-deduplicated before processing and verified
with the owning arena's secret. A payment state machine rejects impossible
transitions. → [PAYMENTS.md](PAYMENTS.md)

## 8. Tickets

QR payload `AP1.<token>.<hmac>`, where the HMAC key is **derived per arena**, so
a ticket minted at Arena A fails signature verification at Arena B before any
database query happens. Validation is a conditional `UPDATE … WHERE
status='CONFIRMED'`; zero rows means a concurrent scan won, and the answer is
`ALREADY_USED`. Every scan is logged with arena, ticket, scanner and outcome.
→ [ARCHITECTURE.md](ARCHITECTURE.md)

## 9. Security model

Defence in depth with each layer assuming the one above it failed: hostname
resolution, the single authorisation choke point, scoped repositories, database
constraints, and infrastructure (CSP with a per-request nonce and
`strict-dynamic`, same-origin enforcement on mutations, per-arena rate limits,
private caching on account and admin routes, sandboxed upload serving).
→ [SECURITY.md](SECURITY.md)

## 10. Threat model

Assets, actors, trust boundaries, and eleven threats (T1–T11) each with its
control and its residual risk — cross-tenant read, privilege escalation,
subdomain takeover, webhook forgery, ticket forgery, credential theft,
impersonation abuse, enumeration, denial of service, log leakage, supply
chain. → [THREAT_MODEL.md](THREAT_MODEL.md)

## 11. API

Uniform envelope `{ success, data | message + code }`. Public routes resolve the
tenant from the host; admin routes go through `adminRoute(permission, handler)`,
which authenticates, resolves the admin's selected arena, enforces same-origin
on mutations and checks the permission before the handler runs. Platform routes
go through `platformRoute(permission, handler)`. → [API.md](API.md)

## 12. Test coverage

**347 tests in 27 files, all passing**, plus 2 Playwright end-to-end specs.
Integration tests run against an in-memory PGlite with the real migration
chain, so constraints are exercised rather than mocked.

The tenancy-specific suites: tenant resolution, authorization, cross-tenant
services, tenant constraints, customer identity, payment accounts, payment
recovery, ticket security, content security, cache safety, onboarding, platform
operations, and an invariant suite that asserts structural properties over the
whole schema (every tenant table has `arena_id NOT NULL`; no arena is
ownerless; no child row's arena differs from its parent's).

## 13. Performance

Indexes on every `arena_id` and on the composite keys queries actually use.
Tenant resolution is cached per request via `React.cache`, so a page renders
with one resolution, not one per component. Booking capacity is enforced by a
conditional update rather than a read-then-write, which removes the lock
contention a serialisable transaction would have introduced. All pages are
server-rendered on demand — the honest cost of correct tenancy, since a page
cannot be prerendered for a tenant that is not known at build time.

## 14. Deployment

Managed PostgreSQL (PGlite is development only, and is single-process — two
processes opening it corrupt it). Wildcard DNS and a wildcard certificate for
`*.APP_ROOT_DOMAIN`, plus per-domain certificates for verified custom domains.
Cron for housekeeping. → [DEPLOYMENT.md](DEPLOYMENT.md), [OPERATIONS.md](OPERATIONS.md)

## 15. Environment variables

22 documented in `.env.example`. Required in production: `APP_URL`,
`APP_ROOT_DOMAIN`, `DATABASE_URL`, `SESSION_SECRET`, `QR_SECRET`,
`CREDENTIALS_KEY`, `CRON_SECRET`, and the payment, storage and email settings
for the drivers in use. The three secrets are separate so any one can be
rotated alone — with the caveat, stated in OPERATIONS.md, that rotating
`CREDENTIALS_KEY` makes stored payment credentials unreadable and requires
re-entry.

## 16. Remaining risks

Recorded honestly in [THREAT_MODEL.md](THREAT_MODEL.md). The seven that matter
most:

1. **No database-level RLS.** Isolation is enforced by application code plus
   composite foreign keys. A raw query written without `forArena` would not be
   stopped by the database. The invariant tests and code review are the
   mitigation; PostgreSQL row-level security is the real fix.
2. **Rate limiting is in-process.** It resets on deploy and does not coordinate
   across instances. Multi-instance deployment needs a shared store.
3. **Custom domain verification is DNS-based** and trusts DNS. A registrar
   compromise is out of scope.
4. **Impersonation is read-only by construction**, but a platform operator can
   still read any tenant's data. That is deliberate and audited, not prevented.
5. **Secrets are encrypted with one key.** Compromise of `CREDENTIALS_KEY`
   exposes every arena's payment credentials. Per-tenant keys or a KMS would
   reduce the blast radius.
6. **Background jobs run as the platform**, iterating arenas; a bug in one
   could touch many.
7. **`style-src` allows `unsafe-inline`** so the design system and per-arena
   themes work. Scripts have no such exemption.

## 17. Known limitations

- Billing records subscriptions and usage but does not charge for them; no
  invoicing, proration or dunning.
- No tenant data export or self-serve deletion.
- Arena deletion is a soft delete; hard deletion is a manual operation.
- Organizations exist as a grouping but have no UI of their own.
- Email is a single provider with no per-arena sending domain, so transactional
  mail comes from the platform's address.
- No per-tenant observability dashboard; logs carry the arena id but nothing
  aggregates them per tenant.

## 18. Recommended next steps

In the order I would actually do them:

1. **PostgreSQL row-level security**, with the arena set as a session variable.
   This turns the strongest remaining assumption — that every query goes
   through `forArena` — into something the database enforces.
2. **Shared-store rate limiting** (Redis), so limits survive deploys and hold
   across instances.
3. **Per-arena or KMS-managed encryption keys** for payment credentials.
4. **Finish billing**: charge subscriptions, generate invoices, handle failure
   and dunning.
5. **Tenant data export and deletion**, which is both a feature and, in most
   jurisdictions, an obligation.
6. **Per-tenant observability** — error rate, booking conversion and payment
   failures per arena, so a problem in one tenant is visible before they report
   it.
7. **Automated cross-tenant fuzzing in CI**: generate two arenas, then
   systematically attempt every route with the other's identifiers. The manual
   version of this audit found real bugs; it should not stay manual.

---

## Definition of Done

Each line was checked against the code, not from memory.

| | Requirement | Evidence |
|---|---|---|
| ✅ | Every tenant table carries `arena_id NOT NULL` | Asserted by the invariant suite, which reads `information_schema` rather than a hand-kept list |
| ✅ | No query reaches tenant data without an arena | Services take `arenaId` first and read through `forArena()`; the nine that do not use the helper scope explicitly on `arena_id`, and three (`arenas`, `onboarding`, `platform`) are cross-tenant by design |
| ✅ | Arena id is never accepted from the client | Grep of `app/api`: every `arenaId` is `tenant.arenaId` (host-derived) or `arena.arenaId` (membership-derived). The two exceptions are arena switching, which checks membership before setting the cookie, and impersonation, which is the one authorised platform-level crossing |
| ✅ | One authorization choke point | `authorizeArena` / `authorizePlatform` in `server/tenant/authorization.ts`; a platform permission checked at arena level throws rather than failing open |
| ✅ | Cross-tenant reads return "not found", not "forbidden" | `forArena().require()`; verified by the cross-tenant service tests |
| ✅ | Database constraints back the application up | Composite FKs `(arena_id, id)`, per-tenant unique indexes, CHECK constraints — migrations `0009`, `0007` |
| ✅ | No floating point in the money path | Every amount column is `integer`; no `numeric`/`real`/`decimal` exists |
| ✅ | Client-supplied amounts are never trusted | `/api/payments/initialize` accepts `{ bookingId }` only |
| ✅ | Payment credentials are per arena and encrypted | `arena_payment_accounts`, AES-256-GCM, refusal rather than fallback when more than one arena exists |
| ✅ | Webhooks are replay-safe and verified per arena | `payment_events` fingerprint claim before processing; signature checked with the owning arena's secret |
| ✅ | Tickets cannot cross arenas | QR HMAC key is derived per arena, so verification fails before any query |
| ✅ | Impersonation is read-only, time-limited, audited | `IMPERSONATION_PERMISSIONS` is `*.view` only; 30-minute TTL; `impersonations` row; banner on every screen |
| ✅ | No secrets in logs | Audited across the logger and every call site: no password, hash, token, key or authorization header is logged |
| ✅ | No destructive migration run without confirmation | 15 forward-only migrations, add→backfill→enforce; nothing dropped but two legacy identity columns after their data was moved and verified |
| ✅ | Tests pass | 347 in 27 files, against real migrations on PGlite, plus 2 Playwright specs |
| ✅ | Typecheck clean | `tsc --noEmit`, 0 errors, `strict` on |
| ✅ | Lint clean | 0 errors. 4 warnings remain: three in vendored shadcn/ui primitives, one a deliberate full-page reload |
| ✅ | Production build succeeds | 126 routes, all server-rendered on demand, 0 prerendered |
| ✅ | No `any`, no dead code, no commented-out production code | 0 matches for `: any`, 0 for `TODO`/`FIXME`/`XXX` across `server`, `app`, `lib` |
| ✅ | Documentation complete | The eleven documents the specification named, plus this summary and the phase-by-phase record |
| ⚠️ | Row-level security in the database | **Not done.** Isolation is application code plus foreign keys. This is the first item in the recommended next steps, and the largest remaining assumption |
| ⚠️ | Distributed rate limiting | **Not done.** In-process only; resets on deploy and does not coordinate across instances |
