import { NextResponse } from "next/server"
import { env } from "@/server/env"
import { AppError } from "@/server/http/errors"
import { getClientIp } from "@/server/http/request"
import { enforceRateLimit, RATE_LIMITS, scopedKey } from "@/server/http/rate-limit"
import { logger, serializeError } from "@/server/observability/logger"
import { exchangeGoogleCode, resolveGoogleCustomer, stateMatches, takePendingGoogleSignIn } from "@/server/auth/google"
import { createAuthSession, setSessionCookie } from "@/server/auth/session"
import { safeNextPath } from "@/lib/safe-next"
import { requirePublicTenantFromRequest } from "@/server/tenant"

/** Google redirects here with `code` + `state`. Failures land back on /login with a short error code. */
export async function GET(req: Request) {
  const url = new URL(req.url)
  // Redirect via APP_URL: it's the host Google returned to, so it's where the session cookie is set.
  const back = (path: string) => NextResponse.redirect(new URL(path, env.APP_URL))
  const pending = await takePendingGoogleSignIn()

  if (!env.googleEnabled) return back("/login?error=google_unavailable")
  if (url.searchParams.get("error")) return back("/login?error=google_cancelled")
  const code = url.searchParams.get("code")
  if (!pending || !code || !stateMatches(pending, url.searchParams.get("state"))) return back("/login?error=google")

  // The Google account signs in to *this* storefront; the same person may
  // hold a separate account at another arena.
  const tenant = await requirePublicTenantFromRequest(req)
  const ip = getClientIp(req)
  try {
    await enforceRateLimit(RATE_LIMITS.login, scopedKey(tenant.arenaId, ip))
    const claims = await exchangeGoogleCode(code, pending)
    const { customer } = await resolveGoogleCustomer(tenant.arenaId, claims, { ip })
    const { token, ttl } = await createAuthSession("customer", customer.id, { ip, userAgent: req.headers.get("user-agent") })
    await setSessionCookie("customer", token, ttl)
    return back(safeNextPath(pending.next))
  } catch (err) {
    if (!(err instanceof AppError)) logger.error("auth.google_callback_failed", { error: serializeError(err) })
    const reason = err instanceof AppError ? ({ ACCOUNT_DISABLED: "account_disabled", RATE_LIMITED: "rate_limited" } as Record<string, string>)[err.code] ?? "google" : "google"
    return back(`/login?error=${reason}`)
  }
}
