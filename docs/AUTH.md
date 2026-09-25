# Authentication

> Who someone is. For *what they may do*, see [SECURITY.md](SECURITY.md) and
> [MULTI_TENANCY.md](MULTI_TENANCY.md); authentication never grants access to
> an arena by itself.

## Two principals, deliberately separate

| | Staff (`users`) | Customer (`customers`) |
|---|---|---|
| Cookie | `ap_admin_session` | `ap_customer_session` |
| Session lifetime | 12 hours | 30 days |
| Scope | Global identity; access comes from `arena_memberships` | **Per arena** — one row per (arena, email) |
| Signs in at | `/admin/login` | `/login` on the arena's own host |

They are different tables, different cookies and different code paths. A
customer session can never be mistaken for a staff session, because the
loaders read different cookies and return different types; TypeScript makes
the confusion a compile error rather than a policy.

Customers are scoped to an arena on purpose. The same person booking at two
arenas is two customer rows with two passwords, and neither arena learns the
other exists. Staff are one identity with memberships, because a person really
does work at several arenas and should not juggle logins.

## Sessions

A session is a row in `auth_sessions`. The cookie carries a 32-byte random
token; the database stores only its SHA-256. A stolen database backup
therefore does not yield usable session cookies.

Cookies are `httpOnly`, `sameSite=lax`, `secure` in production, and scoped to
the host that issued them — so an arena's cookie is not sent to another
arena's subdomain. Logout, a password change and a role change all revoke
server-side immediately: `revokeSession` / `revokeAllSessionsFor` delete the
rows, so a revoked cookie is dead on its next request rather than at expiry.

Every authenticated request reloads the principal from the database —
memberships and permissions included. Nothing about authority is cached in the
cookie, which is why removing someone from an arena takes effect at once.

## Passwords

scrypt, `N=16384, r=8, p=1`, 16-byte per-password salt, stored as
`scrypt$N$r$p$salt$hash`. Verification is constant-time
(`timingSafeEqual`). The parameters live in the stored string, so they can be
raised later and old hashes still verify.

Passwords, hashes and tokens are never logged. Sign-in failures are rate
limited per arena and per identifier (see below).

## Tokens: reset, verification

Both follow the same shape:

- 32 random bytes, sent to the user; only the SHA-256 is stored.
- Single use — consumed inside a transaction, so two clicks cannot both spend it.
- Short lived: **30 minutes** for a password reset, **24 hours** for email
  verification.
- Scoped to one arena. A token minted at Arena A cannot be redeemed at Arena B,
  because the lookup is `(arena_id, token_hash)`.
- The response is identical for a known and an unknown email, and the email is
  sent *after* the response (`after()`), so timing does not leak membership.

The failure message for a bad, spent or expired token is one string. Which of
the three it was is not an attacker's business.

## Google sign-in (customers)

Authorisation-code flow with PKCE. State, PKCE verifier and nonce live in a
short-lived (`10 min`) cookie scoped to the callback path. The returned ID
token's claims are all checked: issuer in the expected set, audience equal to
our client id (with `azp` when the audience is an array), nonce equal to the
one we issued, `exp` not past allowing 60 seconds of clock skew, `sub` present,
and `email_verified` true.

There is no JWS signature check, and that is deliberate rather than an
omission: the token comes straight back from Google's token endpoint over TLS
on a connection we opened, which OpenID Connect Core §3.1.3.7 accepts as
issuer authentication for this flow. The code says so at the function. A token
arriving by any other route would need the signature verified.

The resulting customer is resolved **per arena** — signing in with Google at
Arena A creates or matches Arena A's customer row only.

## Rate limiting

Sign-in, sign-up, password reset, email verification, Google sign-in, booking
and the waiting list are all limited, keyed by `scopedKey(arenaId, identifier)`
where the identifier is the client IP or the submitted email. The arena is part
of the key so one tenant's traffic — or one tenant's attacker — cannot exhaust
another tenant's allowance.

## What authentication does *not* do

Being signed in as staff grants nothing. Every admin route and server component
calls `authorizeArena(user, arenaId, permission)`, which is satisfied only by an
ACTIVE membership of that arena carrying that permission. A platform role does
not satisfy it either — platform operators reach tenant data only through
explicit, time-limited, read-only impersonation, which is audited.
