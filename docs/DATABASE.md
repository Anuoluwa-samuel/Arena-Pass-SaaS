# Database

> Every tenant-owned table carries `arena_id NOT NULL`, and children reference
> their parent's `(arena_id, id)` so a cross-tenant row cannot be written. See
> **`docs/MULTI_TENANCY.md`**.

PostgreSQL 14+ (PGlite 17 locally). Schema lives in `server/db/schema.ts`; migrations in `server/db/migrations` are generated with `npm run db:generate` and applied automatically on boot (`server/db/index.ts`) or with `npm run db:migrate`.

## Entities

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `arenas` | Tenant root | unique `slug`, soft delete |
| `roles`, `role_permissions` | RBAC | unique role `key`; PK `(role_id, permission)` |
| `users` | Admin/staff accounts | unique lower(email), `role_id` FK, soft delete |
| `customers` | Buyers (guest or registered) | unique lower(email), nullable `password_hash` |
| `auth_sessions` | Server-side sessions for both principals | unique `token_hash`, `expires_at`, `revoked_at` |
| `sessions` | Football sessions | CHECK `total_capacity = teams_count × players_per_team`; teams 1–8; players 1–4; `booked_count + held_count ≤ total_capacity`; `ends_at > starts_at`; `booking_deadline > booking_opens_at` |
| `teams` | 1..N per session | unique `(session_id, team_number)` |
| `session_slots` | Pre-generated player slots | unique `(session_id, team_number, slot_number)`; unique `booking_id`; status/booking consistency CHECK |
| `bookings` | Slot reservations | unique `idempotency_key`; indexes on `(session_id, status)`, `(status, expires_at)` |
| `tickets` | Issued after verified payment | unique `ticket_number`, unique `booking_id`, unique `qr_token` |
| `payments` | Provider attempts | unique `reference` |
| `transactions` | Immutable ledger (CHARGE / REFUND) | FK to payment, optional ticket |
| `ticket_validations` | Every scan and its result | |
| `waitlist_entries` | Sold-out interest | unique `(session_id, lower(email))` |
| `media` | Uploaded files (metadata only; bytes in object storage) | unique `storage_key`, soft delete |
| `cms_pages` | Draft/published JSON per slug | unique `(arena_id, slug)` |
| `cms_services`, `faqs`, `announcements`, `banners` | Orderable/publishable content | |
| `notifications` | Outbound messages and their delivery state | |
| `audit_logs` | Administrative actions | indexes on time, entity, actor |
| `system_settings` | Typed JSON settings per arena (null = global) | unique `(coalesce(arena_id), key)` |

Sequence `ticket_number_seq` feeds `AP-YYYY-000001` style numbers.

## Money

Integer minor units everywhere (`ticket_price`, `amount`, `price`). Formatting happens at the edge with `formatMoney()`.

## Timestamps

All `timestamptz`. `created_at`/`updated_at` on mutable tables; `deleted_at` soft delete on arenas, users, customers, sessions, media.

## Cascades

- Deleting a session cascades to its teams and slots; bookings, tickets and payments use `RESTRICT` (financial history is never cascaded away — sessions are soft-deleted instead).
- Media referenced by CMS rows uses `SET NULL`.
- Role deletion is restricted while users reference it.

## Concurrency model

- Session row lock (`FOR UPDATE`) serialises bookings per session.
- `FOR UPDATE SKIP LOCKED` on slot claiming lets concurrent transactions on real Postgres pick different rows.
- Constraints are the last line of defence; the integration suite (`tests/integration/booking-flow.test.ts`) fires 50 simultaneous bookings at a 32-slot session and asserts exactly 32 succeed.

Note: PGlite is single-connection and serialises transactions, so the local test proves logic and constraints; run the same suite against a real Postgres (set `DATABASE_URL` in the test environment) to exercise true parallelism.
