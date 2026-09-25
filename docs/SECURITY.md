# Security

> Sign-in and session mechanics: [AUTH.md](AUTH.md). Money: [PAYMENTS.md](PAYMENTS.md).
> Tenant isolation: [MULTI_TENANCY.md](MULTI_TENANCY.md). Threats: [THREAT_MODEL.md](THREAT_MODEL.md).

This document lists the controls in the application and where each one stops.
Tenant isolation is the subject of its own document because it is the property
everything else in a multi-tenant system depends on.

## Controls

| Area | Control |
| --- | --- |
| Authentication | scrypt password hashing (N=16384), constant-time comparison, timing-safe login (hash always computed), server-side sessions with SHA-256 token storage, httpOnly + SameSite=Lax + Secure cookies, revocation on logout/role change/password change/deactivation |
| Password reset (customers) | 256-bit random token, only its SHA-256 stored; single use (claimed by conditional UPDATE), 30-minute expiry, a new request retires older links; identical response and timing for unknown emails (lookup only, issue + send in `after()`); link emailed directly, never persisted in the admin-visible notifications table; reset revokes all sessions; reset page sends `Referrer-Policy: no-referrer` and strips the token from the address bar |
| Google sign-in (customers) | OIDC authorization-code flow with PKCE (S256), `state` and `nonce` in a 10-minute httpOnly cookie scoped to the callback path; ID token claims checked (`iss`, `aud`/`azp`, `exp`, `nonce`, `email_verified`); accounts keyed by Google `sub`; first link to an existing password account clears that password and revokes its sessions (sign-up doesn't verify email, so a pre-registered password may not be the owner's); `next` redirects restricted to same-site paths |
| Authorisation | DB-stored role → permission map; `requirePermission()` in every admin route handler and server component; super-admin-only guards for role escalation; users cannot demote/disable themselves |
| CSRF | Origin/Host check on every cookie-authenticated mutation (`assertSameOrigin`) plus SameSite cookies |
| Rate limiting | Login (per IP and per email), signup, booking creation, ticket validation, uploads |
| Input validation | zod at the API boundary, business checks in services, CHECK/UNIQUE constraints in Postgres |
| SQL injection | Drizzle parameterised queries; raw SQL only via tagged templates |
| XSS | React escaping; CMS content rendered as text (no HTML injection); SVG uploads rejected if they contain `<script>` |
| Uploads | Magic-byte content sniffing, allow-list of image types, size limit, random file names, path traversal guard in the storage adapter, `nosniff` when serving |
| Payments | Card data never handled; provider verification server-side; amount + currency equality check; webhook signature verification (HMAC-SHA512) then re-verification via API; idempotent confirmation |
| Tickets | Random 24-byte `qr_token` + HMAC in the QR payload; signed access key for ticket links; conditional UPDATE prevents double admission; refunded/cancelled tickets rejected at the gate |
| Overselling | Row lock + `SKIP LOCKED` slot claim + capacity CHECK + unique slot/booking/ticket indexes |
| Secrets | `.env*` git-ignored; `server/env.ts` fails fast when production secrets are missing; mock provider forbidden in production |
| Headers | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, no `X-Powered-By` |
| Information exposure | Internal errors return a generic message and are logged server-side; customer emails masked in public booking responses; passwords never serialised |
| Audit | Login/logout, session, ticket, payment, CMS, user, role and settings changes recorded with actor and IP |

## Known limitations / next steps

- Rate limiting is per instance; use a Redis-backed store for multi-instance deployments.
- Admin users have no self-service password reset (admins reset each other's passwords from the Administrators page).
- Customer sign-up does not verify email ownership. Password reset and Google sign-in both prove it, which is why they revoke sessions and why linking Google clears an earlier password.
- Consider a Content-Security-Policy header once third-party scripts are finalised.
- Enable 2FA for SUPER_ADMIN accounts before handling live payments.

## Multi-tenant controls

| Area | Control |
| --- | --- |
| Tenant resolution | Hostname → verified custom domain or single-label subdomain; anything else resolves to nothing. A subdomain matching no arena never falls back to another arena. |
| Authorisation | An ACTIVE `arena_memberships` row is the only thing that grants arena access. A platform role grants none. |
| Service layer | Every tenant-facing service takes the arena explicitly; the arena is part of the `WHERE`. Cross-tenant reads answer *not found*, never *forbidden*. |
| Database | `arena_id NOT NULL` on every tenant-owned table; 22 composite foreign keys on `(arena_id, id)` make a cross-tenant row unrepresentable. |
| Impersonation | `platform.impersonate` only, with a written reason; read-only, one at a time, 30-minute expiry, audited, and shown in a banner throughout. |
| Payments | Per-arena provider credentials, AES-256-GCM at rest, write-only through the API. No platform fallback past the first arena. |
| Webhooks | Recorded by a fingerprint of their own bytes before anything else, so a replay is acknowledged without reprocessing; signature verified with that arena's key. |
| Tickets | QR codes signed with a per-arena derived key; the scan log stores a redacted fragment, never a usable payload. |
| Uploads | SVGs that can execute, embed or fetch are rejected rather than sanitised; every upload served with `default-src \'none\'; sandbox`. |
| Content Security Policy | Per-request nonce, `strict-dynamic`, no `unsafe-inline` for scripts. |
| Rate limiting | Keyed `(arena, identifier)` so one tenant cannot exhaust another's allowance. |
| Caching | Every tenant surface renders on demand; cacheable endpoints declare `Vary: Host, X-Arena-Slug`; failures are `no-store`. |
