import "server-only"
import { createHash } from "node:crypto"
import { cookies } from "next/headers"
import { and, eq, sql } from "drizzle-orm"
import { db, schema } from "@/server/db"
import { env } from "@/server/env"
import { AppError, isUniqueViolation } from "@/server/http/errors"
import { logger } from "@/server/observability/logger"
import { recordAudit } from "@/server/services/audit"
import { revokeAllSessionsFor } from "./session"
import { randomToken, safeEqual } from "./tokens"

/*
 * "Continue with Google": OpenID Connect authorization-code flow with PKCE,
 * state (CSRF) and nonce (replay) checks. No SDK — two HTTPS endpoints.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"]
const STATE_COOKIE = "ap_google_oauth"
const STATE_COOKIE_PATH = "/api/auth/customer/google"
const STATE_TTL_SECONDS = 10 * 60
const CLOCK_SKEW_SECONDS = 60

export interface PendingGoogleSignIn {
  state: string
  nonce: string
  verifier: string
  next: string
}

export interface GoogleClaims {
  sub: string
  email: string
  name: string
}

const failed = (message = "Google sign-in failed. Please try again.") => new AppError("OAUTH_FAILED", message)

export function googleRedirectUri() {
  return new URL("/api/auth/customer/google/callback", env.APP_URL).toString()
}

export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url")
}

/** Stores state/nonce/PKCE verifier in a short-lived httpOnly cookie and returns Google's consent URL. */
export async function beginGoogleSignIn(next: string) {
  if (!env.googleEnabled) throw new AppError("NOT_FOUND", "Not found")
  const pending: PendingGoogleSignIn = { state: randomToken(24), nonce: randomToken(24), verifier: randomToken(48), next }
  const store = await cookies()
  store.set(STATE_COOKIE, Buffer.from(JSON.stringify(pending)).toString("base64url"), {
    httpOnly: true,
    // Lax still sends the cookie on Google's top-level GET redirect back to the callback.
    sameSite: "lax",
    secure: env.isProd,
    path: STATE_COOKIE_PATH,
    maxAge: STATE_TTL_SECONDS,
  })
  const url = new URL(AUTH_ENDPOINT)
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: pkceChallenge(pending.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString()
  return url.toString()
}

/** Reads and clears the pending sign-in cookie (single use). Null if absent or malformed. */
export async function takePendingGoogleSignIn(): Promise<PendingGoogleSignIn | null> {
  const store = await cookies()
  const raw = store.get(STATE_COOKIE)?.value
  store.set(STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: env.isProd, path: STATE_COOKIE_PATH, maxAge: 0 })
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<PendingGoogleSignIn>
    if (!parsed.state || !parsed.nonce || !parsed.verifier || typeof parsed.next !== "string") return null
    return parsed as PendingGoogleSignIn
  } catch {
    return null
  }
}

export function stateMatches(pending: PendingGoogleSignIn, returned: string | null) {
  return Boolean(returned) && safeEqual(pending.state, returned!)
}

/** Exchanges the authorization code (with the PKCE verifier) and returns validated identity claims. */
export async function exchangeGoogleCode(code: string, pending: PendingGoogleSignIn, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
      code_verifier: pending.verifier,
    }),
  })
  if (!res.ok) {
    logger.warn("auth.google_token_exchange_failed", { status: res.status })
    throw failed()
  }
  const body = (await res.json().catch(() => ({}))) as { id_token?: string }
  if (!body.id_token) throw failed()
  return verifyGoogleIdToken(body.id_token, { clientId: env.GOOGLE_CLIENT_ID!, nonce: pending.nonce })
}

/**
 * Validates the claims of an ID token received directly from Google's token
 * endpoint. OpenID Connect Core §3.1.3.7 allows TLS to authenticate the issuer
 * in this flow instead of a JWS signature check; every claim check still applies.
 */
export function verifyGoogleIdToken(idToken: string, expected: { clientId: string; nonce: string; now?: number }): GoogleClaims {
  const parts = idToken.split(".")
  if (parts.length !== 3) throw failed()
  let claims: Record<string, unknown>
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
  } catch {
    throw failed()
  }
  const now = Math.floor((expected.now ?? Date.now()) / 1000)
  const aud = claims.aud
  const audienceOk = aud === expected.clientId || (Array.isArray(aud) && aud.includes(expected.clientId) && claims.azp === expected.clientId)

  if (!GOOGLE_ISSUERS.includes(String(claims.iss))) throw failed()
  if (!audienceOk) throw failed()
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS < now) throw failed()
  if (typeof claims.nonce !== "string" || !safeEqual(claims.nonce, expected.nonce)) throw failed()
  if (typeof claims.sub !== "string" || !claims.sub) throw failed()
  if (typeof claims.email !== "string" || !(claims.email_verified === true || claims.email_verified === "true")) {
    throw failed("Your Google account's email address isn't verified.")
  }
  const email = claims.email.toLowerCase()
  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : email.split("@")[0]
  return { sub: claims.sub, email, name: name.slice(0, 80) }
}

/**
 * Finds or creates the customer for a verified Google identity:
 * 1. the account already linked to this Google `sub`;
 * 2. else the account with the same (Google-verified) email, which gets linked;
 * 3. else a new customer with no password.
 */
export async function resolveGoogleCustomer(arenaId: string, claims: GoogleClaims, meta: { ip?: string | null } = {}, isRetry = false): Promise<{ customer: schema.Customer; created: boolean; passwordCleared: boolean }> {
  const database = await db()
  // Normalise here rather than trusting callers: a case mismatch would miss the
  // existing row and collide with the lower(email) unique index on insert.
  const email = claims.email.trim().toLowerCase()
  const linked = await database.query.customers.findFirst({ where: and(eq(schema.customers.googleSub, claims.sub), eq(schema.customers.arenaId, arenaId)) })
  const existing = linked ?? (await database.query.customers.findFirst({ where: and(sql`lower(${schema.customers.email}) = ${email}`, eq(schema.customers.arenaId, arenaId)) }))

  if (existing) {
    if (existing.deletedAt || !existing.isActive) throw new AppError("ACCOUNT_DISABLED", "This account has been disabled")
    if (existing.googleSub && existing.googleSub !== claims.sub) throw failed("This email is already linked to a different Google account.")
    const linking = !existing.googleSub
    // Sign-up doesn't verify email ownership, so a password set before Google
    // proved ownership may belong to whoever registered this address first.
    // On first link, drop it and end that party's sessions. The owner can set a
    // new password through "Forgot password?", which also proves ownership.
    const clearPassword = linking && Boolean(existing.passwordHash)
    const now = new Date()
    const [customer] = await database
      .update(schema.customers)
      .set({ googleSub: claims.sub, lastLoginAt: now, updatedAt: now, ...(clearPassword ? { passwordHash: null } : {}) })
      .where(eq(schema.customers.id, existing.id))
      .returning()
    if (clearPassword) await revokeAllSessionsFor("customer", existing.id)
    if (linking) {
      await recordAudit(
        { type: "customer", id: existing.id, name: existing.name, ip: meta.ip },
        {
          action: "auth.google_linked",
          description: `${existing.name} linked a Google account${clearPassword ? " (previous password cleared)" : ""}`,
          entityType: "customer",
          entityId: existing.id,
          arenaId: existing.arenaId,
        }
      )
    }
    return { customer, created: false, passwordCleared: clearPassword }
  }

  try {
    const [customer] = await database
      .insert(schema.customers)
      .values({ arenaId, name: claims.name, email, googleSub: claims.sub, lastLoginAt: new Date() })
      .returning()
    return { customer, created: true, passwordCleared: false }
  } catch (err) {
    // Two first-time callbacks for the same identity raced; the loser resolves to
    // the winner's row. Retry once only, so an unexpected conflict can't loop.
    if (!isRetry && isUniqueViolation(err)) return resolveGoogleCustomer(arenaId, claims, meta, true)
    throw err
  }
}
