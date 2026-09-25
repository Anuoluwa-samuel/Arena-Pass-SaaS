# Arena Pass

Football arena session management and e-ticketing. Arena owners schedule sessions of **8 teams × 4 players (32 slots)**, customers book a slot and pay online, and staff validate QR tickets at the gate. Includes a CMS-style admin control centre with role-based access.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript strict |
| UI | Tailwind CSS 4, shadcn/ui, Motion, Recharts |
| Database | PostgreSQL via Drizzle ORM. Embedded Postgres (PGlite) locally, managed Postgres in production |
| Auth | Server-side sessions (httpOnly cookies), scrypt password hashing, DB-stored RBAC |
| Payments | Provider abstraction: Paystack adapter + mock provider for development |
| Tests | Vitest (unit + integration on an in-memory Postgres), Playwright (e2e) |

## Quick start

```bash
npm install
cp .env.example .env        # defaults work out of the box (embedded DB, mock payments)
npm run db:seed             # migrations + baseline + sample data
npm run dev                 # http://localhost:4000
```

Admin: http://localhost:4000/admin — `admin@arenapass.local` / `ChangeMe123!`

Other seeded staff accounts (same password): `grace.admin@`, `musa.manager@`, `folake.finance@`, `sam.staff@`, `tola.ticketagent@` (all `@arenapass.local`).

With `PAYMENT_PROVIDER=mock`, checkout redirects to a test page where you choose a successful or declined payment; the rest of the pipeline (verification, ticket issue, email) runs exactly as in production.

> The embedded database lives in `.data/pglite` and is held exclusively by one process. Stop `npm run dev` before running `npm run db:seed` or `npm run db:reset`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (next/core-web-vitals + TypeScript) |
| `npm test` | Vitest unit + integration suites |
| `npm run test:e2e` | Playwright (needs `npx playwright install chromium`) |
| `npm run db:generate` | Generate a SQL migration from `server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations + ensure baseline rows |
| `npm run db:seed` | Migrate + baseline + development sample data |
| `npm run db:reset` | Delete the embedded DB and reseed |

## Project structure

```
app/
  (public)/        customer site: home, sessions, checkout, tickets, account, about, faq, contact
  admin/           admin control centre (sidebar layout, RBAC-guarded pages)
  api/             route handlers → services; uniform JSON envelope
server/            server-only code (never bundled to the client)
  db/              schema, client (PGlite | pg), migrations, baseline, seed helpers
  auth/            passwords, sessions, RBAC
  services/        sessions, bookings, tickets, payments, customers, cms, media, users, analytics…
  payments/        PaymentProvider interface, Paystack, mock
  notifications/   email channel + templates
  http/            errors, response envelope, validation, rate limiting, admin guard
  storage/         object storage abstraction (local disk adapter)
lib/               client-safe: domain constants, status logic, formatting, zod schemas, api client
components/        ui primitives, site/, admin/, shared/
tests/             unit/, integration/, e2e/
docs/              architecture, multi-tenancy, database, API, auth, payments, billing,
                   security, threat model, operations, deployment
```

## Documentation

Start with **[docs/MULTI_TENANCY.md](docs/MULTI_TENANCY.md)** — it answers how
one arena is kept away from another, which is the design decision everything
else follows from.

- [docs/DELIVERABLES.md](docs/DELIVERABLES.md) — what was built, what remains, and the definition-of-done checklist
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design, booking integrity, session lifecycle
- [docs/MULTI_TENANCY.md](docs/MULTI_TENANCY.md) — the tenant boundary and the five layers that enforce it
- [docs/DATABASE.md](docs/DATABASE.md) — schema, constraints, indexes
- [docs/API.md](docs/API.md) — endpoints, envelope, error codes
- [docs/AUTH.md](docs/AUTH.md) — principals, sessions, passwords, tokens, Google sign-in
- [docs/PAYMENTS.md](docs/PAYMENTS.md) — per-arena provider accounts, the payment state machine, webhooks
- [docs/BILLING.md](docs/BILLING.md) — plans, subscriptions, usage, feature flags
- [docs/SECURITY.md](docs/SECURITY.md) — controls and their limits
- [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) — assets, actors, threats, residual risks
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — migrations, backups, monitoring, incident response
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — environments, secrets, cron, Paystack setup
- [docs/TRANSFORMATION_PLAN.md](docs/TRANSFORMATION_PLAN.md) — the 16 phases of this work, and what each one found
- [docs/AUDIT.md](docs/AUDIT.md) — what the codebase looked like before this work
