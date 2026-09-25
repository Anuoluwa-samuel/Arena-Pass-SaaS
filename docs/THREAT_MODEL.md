# Threat model

What Game Slots protects, from whom, and what is still open.

Scope: the multi-tenant SaaS platform — one deployment serving many
independent arenas, their staff, and their customers.

## Assets

| Asset | Why it matters |
| --- | --- |
| One arena's operational data | Sessions, bookings, customers, revenue. Visible to a competitor is a commercial loss; alterable is a financial one. |
| Customer personal data | Names, emails, phones, play history. A breach is a regulatory and reputational event. |
| Money in flight | Bookings and refunds. Misdirection sends one arena's takings to another. |
| Payment credentials | Each arena's provider keys. Stolen, they drain that arena's account. |
| Tickets | A ticket is admission. Forged or replayed, it is theft of service. |
| Sessions and credentials | Staff and customer accounts. |
| The platform itself | Role catalogue, arena states, subscriptions. Compromise reaches every tenant. |

## Actors

| Actor | Starting position |
| --- | --- |
| Anonymous visitor | Any hostname, any public endpoint |
| Arena customer | A session for one arena |
| Arena staff | An ACTIVE membership with a role, in one or more arenas |
| Arena owner | The strongest role *inside* a tenant |
| Platform operator | `platform.*` permissions, no tenant access by default |
| Payment provider | Can reach the webhook endpoint |
| External attacker | Network access, no credentials |

## Trust boundaries

```
internet ──▶ CDN / host ──▶ proxy (CSP, cookie redirect) ──▶ route handler
                                                               │
                                     ┌─────────────────────────┴──────────┐
                                     │ authentication (server session)    │
                                     │ tenant resolution (hostname)       │
                                     │ authorization (membership + role)  │
                                     └─────────────────────────┬──────────┘
                                                               ▼
                                                     service (arena-scoped)
                                                               ▼
                                                  database (composite keys)
provider ──▶ webhook ──▶ signature verified with *that arena's* key
```

Everything left of the route handler is untrusted, including the Host header,
every cookie value, and every field of a webhook body.

## Threats and controls

### T1 — A tenant reads or changes another tenant's data
*Arena staff, arena owner, or anyone with a stolen id.*

Membership decides access, not an email, slug or request field. Services take
the arena explicitly and filter on it. The database enforces it with composite
foreign keys. Cross-tenant reads answer *not found*, never *forbidden*, so ids
cannot be enumerated.

**Residual:** a compromised staff account reaches everything that role may see
*within its own arena*. Audit logging records it; nothing prevents it.

### T2 — A hostname is forged to reach another tenant
Hostnames resolve only to a verified domain or a real arena slug; anything else
resolves to nothing. A subdomain matching no arena never falls through to the
sole-arena rule.

### T3 — A payment is forged, replayed, or misdirected
The amount is computed server-side from the session's own price and must match
what the provider reports. Webhooks are recorded by a fingerprint of their own
bytes before anything else, so a replay collides with the stored row; the
signature is then verified with *that arena's* key. Each arena is paid into its
own account, and with more than one arena there is no platform fallback.

**Residual:** a provider that signs per account but gives no usable reference
would need per-arena webhook paths. Noted in the Phase 8 record.

### T4 — A ticket is forged, reused, or used at the wrong gate
QR payloads are an opaque random token plus an HMAC derived per arena, so a
code fails at another arena's gate before any lookup. Admission is a
conditional update, so simultaneous scans admit exactly once. The scan log
stores a redacted fragment, never a usable payload.

### T5 — Privilege escalation
Roles are a platform-wide catalogue, so editing them is `platform.roles.manage`
— an arena owner widening `MANAGER` would have widened it in every tenant.
Only an owner may grant the owner role. Platform roles are not assignable from
an arena. Role and status changes revoke sessions immediately.

### T6 — Stored XSS through uploads or content
CMS content is structured data rendered as text; there is no
`dangerouslySetInnerHTML` near it. SVG uploads are **rejected** — not cleaned —
when they contain anything that can execute, embed or fetch, and every upload
is served with `default-src 'none'; sandbox`. Pages carry a nonce-based CSP
with no `unsafe-inline` for scripts.

**Residual:** `style-src` keeps `unsafe-inline` for the design system and the
per-arena theme. Inline styles cannot execute script; the exposure is CSS
injection, not code execution.

### T7 — CSRF
Cookies are `httpOnly`, `SameSite=Lax`, `Secure` in production. Every mutation
additionally asserts a same-origin `Origin` header. `form-action 'self'` and
`frame-ancestors 'none'` close the framing routes.

### T8 — A shared cache serves one tenant's response to another
Tenant resolution reads request headers, so every page and route is dynamic —
the production build prerenders only the 404 page. Cacheable endpoints declare
`Vary: Host, X-Arena-Slug`. Private pages are `no-store`; failures are never
cached.

**Residual:** the page renderer overwrites the `Cache-Control` set in config
for rendered pages, leaving Next's `no-cache, must-revalidate`. Those responses
carry no `ETag` or `Last-Modified`, so a shared cache has nothing to revalidate
against and cannot reuse a stored copy — but this should be confirmed against
the real CDN on deployment.

### T9 — Credential theft
Passwords are scrypt with a per-password salt. Reset and verification tokens
are stored only as SHA-256, single-use, short-lived, and invalidated when a new
one is issued or the address changes. Provider credentials are AES-256-GCM at
rest, write-only through the API, masked in the audit trail. No secret is
logged.

### T10 — Denial of service by a noisy or hostile tenant
Rate limits are keyed `(arena, identifier)`, so one tenant cannot exhaust
another's allowance. Uploads are size- and type-limited. Every listing is
paginated with a server-side maximum.

**Residual:** the limiter is in-process. Behind more than one instance it
should be backed by a shared store; the interface allows it.

### T11 — A platform operator overreaches
Platform standing grants no tenant access. Impersonation requires
`platform.impersonate`, a written reason, and is read-only, single, expiring
and audited, with a banner on every screen while it lasts.

**Residual:** a platform operator with database access is outside this model.
Infrastructure controls apply there.

## Residual risks, collected

1. A compromised staff account acts freely within its own arena.
2. `GET /api/bookings/[id]` is tenant-scoped but relies on an unguessable UUID
   within an arena — guest checkout has no session to check against. A signed
   access key, as tickets already use, is the fix.
3. `style-src 'unsafe-inline'`.
4. Rendered-page cache headers depend on Next's default; confirm behind the CDN.
5. The rate limiter is per instance.
6. Staff accounts have `email_verified_at` and no flow to set it; confirmation
   belongs with the invitation flow.
7. Production runtime behaviour — headers, managed Postgres, blob storage — is
   unverified in this environment by design.

## Keeping this honest

Every control above has a test. Cross-tenant access, IDOR, privilege
escalation, webhook replay and forgery, concurrent booking at capacity,
concurrent admission, and the database invariants are all asserted in
`tests/integration/`. A control without a test is a claim, not a control.
