# Payments

> Money taken from an arena's customers. For what *arenas* pay the platform,
> see [BILLING.md](BILLING.md). The two are separate systems and share no
> tables.

## Money is integers

Every amount is stored in minor units (kobo) in an `integer` column — there is
no `numeric`, `real` or `decimal` anywhere in the money path, so no amount is
ever a floating-point number.

A client never states a price. `POST /api/payments/initialize` accepts exactly
`{ bookingId }`; the amount charged is `booking.amount`, which the server wrote
from the session's price when the booking was made. There is no field in any
request schema through which an amount could be supplied.

## Each arena is paid directly

`arena_payment_accounts` holds one row per (arena, provider). Secret keys and
webhook secrets are encrypted at rest with AES-256-GCM
(`CREDENTIALS_KEY`); the plaintext exists only in memory while a request
is being served, and the admin UI shows a masked tail, never the key.

`resolvePaymentAccount(arenaId)` decides which credentials to use:

1. That arena's ACTIVE account for the configured provider. Normal case.
2. The mock provider — no money moves, so a fallback is always safe.
3. **Refuses** if the arena has no account and more than one arena exists.
   This is the important branch: without it, a new tenant's customers would pay
   into whichever account the platform had configured, which is somebody else's
   bank account.
4. The platform's own environment keys, only in the single-arena deployment
   this application grew out of, so that installation keeps working.

`getPaymentProviderForArena` builds the provider client from whatever (1)–(4)
returned. No code path constructs a provider without an arena id.

## The flow

1. `POST /api/payments/initialize` — the server loads the booking through
   `forArena(arenaId)`, checks it is still PENDING and unexpired, creates a
   `PENDING` payment carrying the booking's own amount, and asks **that
   arena's** provider for a checkout URL. An in-flight payment is reused, so a
   refresh does not open a second charge attempt. The response carries the URL
   and reference, never a key.
2. The customer pays on the provider's own page.
3. Two things may confirm it, in either order and possibly both:
   - the **callback** (`/checkout/callback`), which triggers a server-side
     `verify` against the provider — the browser's claim of success is never
     believed;
   - the **webhook**, verified by signature.

Both funnel into the same idempotent settlement, so a duplicate confirmation
issues no second ticket.

## The state machine

`server/payments/state.ts` is the only place payment statuses change:

```
PENDING → PENDING | PAID | FAILED
PAID    → PAID | REFUNDED
FAILED  → FAILED | PAID      (a late success for an abandoned attempt)
REFUNDED → REFUNDED          (terminal)
```

An impossible move throws `CONFLICT` rather than quietly writing. This exists
because a late `failed` webhook used to be able to un-pay a customer who was
already holding a valid ticket.

## Webhooks

`payment_events` records every delivery. The handler:

1. **Claims the delivery first** by inserting a row whose fingerprint is
   `sha256(provider:signature:body)`. A unique violation means these exact
   bytes arrived before, and the request is acknowledged without being acted on
   — replay protection that works even if two deliveries race.
2. Reads the reference from the body *only* to decide which arena's key to
   verify with. Nothing is trusted from the payload before that.
3. Looks up the payment. An unknown reference is recorded and dropped, with no
   detail in the response, so the endpoint cannot be used to enumerate arenas.
4. Verifies the signature with **that arena's** webhook secret. A bad signature
   is recorded, logged with the arena and reference, and rejected.
5. Only then applies the event, through the state machine.

Every row records outcome (`accepted`, `bad_signature`, `unknown_reference`,
`unparseable`), the arena, the payment and the verified payload — which is what
makes a payment dispute answerable months later.

## Recovery

A payment can be stranded if the provider succeeded but our settlement did not
finish. `verifyPayment` is re-runnable and idempotent, the housekeeping cron
re-verifies stale `PENDING` rows, and an admin with `payments.manage` can
verify one by hand. Refunds go through the provider and move the payment to
`REFUNDED`, cancelling the ticket.

## Tenant isolation in this path

- A payment row carries `arena_id` and is reachable only through
  `forArena(arenaId)`.
- Credentials are per arena, encrypted, and never cross.
- A webhook is verified with the owning arena's secret, so Arena A's secret
  cannot authorise a change to Arena B's payment.
- Admin payment screens read through the scoped repository; another arena's
  reference is "not found", not "forbidden".
