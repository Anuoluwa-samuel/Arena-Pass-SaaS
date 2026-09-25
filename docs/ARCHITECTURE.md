# Architecture

> Multi-tenancy is the organising constraint of this system. Read
> **`docs/MULTI_TENANCY.md`** first; it explains the five layers that keep one
> arena out of another.

## Overview

```
Browser ──► Next.js App Router
             ├── Server components   → services (direct, no HTTP hop)
             ├── Client components   → /api/* (fetch, JSON envelope)
             └── Route handlers      → services
                                        │
                              server/services/*  (business rules, transactions, audit)
                                        │
                              Drizzle ORM ──► PostgreSQL (PGlite locally, managed PG in prod)
                                        │
                      PaymentProvider (Paystack | mock)   EmailChannel (Resend | console)   StorageAdapter (local)
```

Everything under `server/` imports `server-only`, so the bundler refuses to ship it to the browser. `lib/` is the shared, client-safe layer: domain constants, the session-status function, zod schemas, formatters and the API client.

## Multi-arena

Every operational table carries `arena_id`. Admin users belong to an arena (super admins may be unscoped); public pages resolve the default arena (`slug = main`). Adding host-based or path-based arena resolution later only touches `getDefaultArena()` and the public layouts.

## Session lifecycle

Stored status (`sessions.status`) is admin-controlled: `DRAFT → PUBLISHED → … → COMPLETED` or `CANCELLED`. Time-derived states (`OPEN_FOR_BOOKING`, `FULL`, `IN_PROGRESS`, `COMPLETED`) are computed by one pure function, `deriveSessionStatus()` in `lib/domain/session-status.ts`, used by cards, detail pages, the admin table and the booking service. A housekeeping job (`syncSessionLifecycle`) persists these transitions so SQL filters stay accurate.

## Capacity and allocation

```
sessions.teams_count (≤ 8) × sessions.players_per_team (≤ 4) = sessions.total_capacity
teams: one row per team
session_slots: one row per (team, slot) — pre-generated when the session is created
```

Defaults come from System Settings (8 × 4). Changing the structure of a session that already has bookings is refused.

## Booking integrity (no overselling)

`createBooking()` runs one transaction:

1. `SELECT … FROM sessions WHERE id = ? FOR UPDATE` — serialises all bookings for that session.
2. Release expired holds for the session (frees slots, decrements `held_count`).
3. Re-check bookability with the live counters (`checkBookable`).
4. Insert the booking with the client's idempotency key (unique index).
5. Claim a slot: `UPDATE session_slots SET status='HELD', booking_id=? WHERE id = (SELECT … WHERE status='FREE' ORDER BY slot_number, team_number LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING …`. No row → `SESSION_FULL`.
6. `held_count + 1` — bounded by the CHECK `booked_count + held_count <= total_capacity`.

Even if the service were bypassed, the database enforces: capacity CHECK, one booking per slot (unique index on `booking_id`), one slot per position (unique `(session, team, slot)`), and one ticket per booking (unique `booking_id`).

Allocation is round-robin (slot 1 of every team, then slot 2 …) so partially sold sessions still have balanced teams; a customer may request a preferred team.

Holds expire after `bookingHoldMinutes` (default 10). Expiry is applied lazily in three places: inside the next booking transaction, on single-session reads (`getSessionById` releases that session's expired holds when `held_count > 0`, which also covers the detail page and the checkout gate), and by a throttled sweep before session lists (`sweepExpiredHolds`, at most every 30s per process). The cron endpoint remains the primary mechanism; the lazy paths keep availability correct when it is late or not configured.

A session reads `FULL` when confirmed plus held slots reach capacity (`booked_count + held_count >= total_capacity`), the same rule `checkBookable` enforces, so cards, the detail page and the booking service always agree. The stored `FULL` written by payment verification still counts confirmed bookings only.

## Payment flow

> Full detail in [PAYMENTS.md](PAYMENTS.md); arena billing in [BILLING.md](BILLING.md).

```
POST /api/bookings ─► createBooking ─► initializePayment ─► provider.initialize ─► authorizationUrl
                                                                   │
customer pays on the provider's hosted page ◄──────────────────────┘
                                                                   │ redirect
/checkout/callback ─► GET /api/payments/verify ─► provider.verify ─► verifyPayment()
provider webhook   ─► POST /api/payments/webhook (signature checked) ─┘
```

`verifyPayment()` is the only path that creates a ticket. It re-queries the provider, checks amount and currency, then in one transaction marks the payment PAID, writes a CHARGE ledger row, flips the slot to CONFIRMED, moves `held_count → booked_count`, marks the session FULL if needed, and inserts the ticket (`ticket_number` from a sequence, random `qr_token`). It is idempotent: callback, webhook and refresh can all call it.

Card data never touches Game Slots. The mock provider is refused in production by `server/env.ts`.

## Tickets and validation

QR payload: `AP1.<qr_token>.<hmac>` — an opaque reference plus an HMAC so forged codes fail before touching the database. Ticket links carry a separate signed access key so email recipients can open their ticket without an account; owners and staff with `tickets.view` can always open it.

`validateTicket()` performs `UPDATE tickets SET status='USED' … WHERE id=? AND status='CONFIRMED'`; zero rows updated means a concurrent scan won, and the response is `ALREADY_USED`. Every scan (valid or not) is logged in `ticket_validations`.

## Authentication and RBAC

> Full detail in [AUTH.md](AUTH.md).

- Admin users and customers are separate principals with separate cookies.
- Sessions are rows in `auth_sessions` (token stored as SHA-256); logout and privilege changes revoke immediately.
- Roles map to permissions in `role_permissions`, seeded from `DEFAULT_ROLE_PERMISSIONS` and editable by super admins.
- Every admin route handler is wrapped in `adminRoute(permission, …)`, which enforces same-origin on mutations and `requirePermission()`. Server components call `requirePermission()` too. `proxy.ts` only redirects unauthenticated users for UX.

## CMS

Structured pages (`homepage`, `about`, `services`, `contact`) are JSON documents validated by zod schemas in `lib/cms/schemas.ts`, with separate `draft` and `published` columns. Collections (services, FAQs, announcements, banners) are ordinary tables with ordering and publish flags. Media is stored through `StorageAdapter` (local disk today; an S3-compatible adapter implements the same three methods) and referenced by id.

## Notifications and audit

`notify()` persists a row then dispatches through the channel adapter; failures are stored on the row and can be retried from the admin. `recordAudit()` never throws and is called by every service mutation; the dashboard's activity feed reads from it.

## Observability

Structured JSON logs in production (`server/observability/logger.ts`), unhandled route errors logged with method + URL, `GET /api/health` for probes. Plug an error tracker into `logger.error` to ship to Sentry or similar.
