# Deployment

## Environments

| | Development | Staging | Production |
| --- | --- | --- | --- |
| Database | PGlite in `.data/pglite` | Managed Postgres | Managed Postgres (with backups, `sslmode=require`) |
| Payments | `mock` | `paystack` (test keys) | `paystack` (live keys) |
| Email | `console` | `resend` | `resend` |
| Secrets | dev defaults | real | real, rotated |

`server/env.ts` validates configuration at boot and refuses to start production with the mock provider or missing secrets.

## Required production variables

```
NODE_ENV=production
APP_URL=https://tickets.example.com
DATABASE_URL=postgres://…?sslmode=require
SESSION_SECRET=<openssl rand -hex 32>
QR_SECRET=<openssl rand -hex 32>
CRON_SECRET=<openssl rand -hex 16>
PAYMENT_PROVIDER=paystack
PAYSTACK_SECRET_KEY=sk_live_…
PAYSTACK_PUBLIC_KEY=pk_live_…
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_…
EMAIL_FROM="Game Slots <tickets@example.com>"
BOOTSTRAP_ADMIN_EMAIL=owner@example.com      # first boot only
BOOTSTRAP_ADMIN_PASSWORD=<strong password>   # change after first login
```

Never commit `.env*` (only `.env.example`). Rotating `QR_SECRET` invalidates existing QR codes and ticket links; rotating `SESSION_SECRET` is safe (sessions are database-backed).

## Steps

1. Provision Postgres; set `DATABASE_URL`.
2. `npm ci && npm run build`.
3. Migrations run automatically on first request (or run `npm run db:migrate` in a release step for zero-surprise deploys).
4. Start with `npm start` (or deploy to Vercel / any Node host). Keep `serverExternalPackages` as configured.
5. Paystack dashboard → Settings → Webhooks: `https://<host>/api/payments/webhook`. Callback URL is set per transaction.
6. Schedule `POST /api/cron/housekeeping` with `Authorization: Bearer $CRON_SECRET` every 1–5 minutes (Vercel Cron, GitHub Actions, or system cron). It releases expired holds, persists session lifecycle transitions, and re-verifies payments still pending after 2 minutes (up to 48 hours old) so a customer who paid and closed the tab still gets a ticket if the webhook was missed.
7. Media: `STORAGE_DRIVER=local` writes to `UPLOAD_DIR` (single server). On Vercel use `STORAGE_DRIVER=blob` (see below).

## Vercel

The app refuses to start on Vercel without a real database and Blob storage (serverless functions have no persistent disk).

1. **Import the repo** in Vercel (production branch `main`). `vercel.json` pins functions to `lhr1` (London, closest to Lagos), uses `npm run vercel-build`, and schedules the daily cron.
2. **Storage → Create → Neon (Postgres)**, region **London (aws-eu-west-2)**, connected to Production. It sets `DATABASE_URL` (use the pooled URL).
3. **Storage → Create → Blob**, a **public** store, connected to Production. Vercel authenticates it with OIDC and sets `BLOB_STORE_ID` (no static token needed). Add `STORAGE_DRIVER=blob`.
4. **Environment variables (Production):** `APP_URL=https://<project>.vercel.app`, `SESSION_SECRET`, `QR_SECRET`, `CRON_SECRET`, `PAYMENT_PROVIDER=paystack`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` (12+ characters; the defaults are refused in production).
5. **Deploy.** Production builds run migrations and create the first admin (`scripts/vercel-build.sh`); preview builds skip migrations so they can't touch the production database.
6. **Paystack → Settings → API Keys & Webhooks:** webhook `https://<project>.vercel.app/api/payments/webhook`.
7. **Cron:** the Hobby plan runs `vercel.json` crons once a day only. For the 5-minute payment recheck, add a free external job (e.g. cron-job.org): `GET https://<project>.vercel.app/api/cron/housekeeping` every 5 minutes with header `Authorization: Bearer <CRON_SECRET>`. Pro plans can use `*/5 * * * *` in `vercel.json` instead.
8. **Email** stays `console` (not delivered) until a domain is verified with Resend; tickets remain available on the site and in customer accounts, but password-reset emails won't arrive.

## Scaling notes

- Stateless app servers: sessions, rate-limit buckets and holds live in the database (rate limiting is in-memory per instance; swap `RateLimitStore` for Redis when running many instances).
- Public session listing responses are cacheable for 15 s; everything else is `no-store`.
- Indexes cover the hot paths: sessions by arena + start, tickets by session/customer, bookings by status + expiry, audit logs by time.

## Health and monitoring

- `GET /api/health` for load-balancer checks.
- Logs are JSON lines in production; ship `level=error` events (`http.unhandled`, `payment.amount_mismatch`, `payment.post_confirm_failed`, `notification.failed`) to your alerting.
- Audit logs in the admin cover every administrative action.
