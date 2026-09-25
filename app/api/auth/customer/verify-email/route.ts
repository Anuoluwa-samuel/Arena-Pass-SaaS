import { z } from "zod"
import { after } from "next/server"
import { route, ok } from "@/server/http/response"
import { assertSameOrigin, getClientIp, parseJson, parseQuery } from "@/server/http/request"
import { enforceRateLimit, RATE_LIMITS, scopedKey } from "@/server/http/rate-limit"
import { confirmEmail, requestEmailVerification } from "@/server/auth/email-verification"
import { requireCustomer } from "@/server/auth/rbac"
import { requirePublicTenantFromRequest } from "@/server/tenant"

/**
 * Confirms an address from the emailed link. No tenant is required: the link
 * is opened from a mail client, which carries no storefront context, and the
 * arena comes from the token's own row.
 */
export const GET = route(async (req) => {
  const { token } = parseQuery(req, z.object({ token: z.string().min(10).max(200) }))
  await enforceRateLimit(RATE_LIMITS.passwordResetSubmit, scopedKey(null, getClientIp(req)))
  const customer = await confirmEmail(token, { ip: getClientIp(req) })
  return ok({ email: customer.email, verifiedAt: customer.emailVerifiedAt }, { message: "Email confirmed" })
})

/** Re-sends the link to the signed-in customer of this storefront. */
export const POST = route(async (req) => {
  assertSameOrigin(req)
  const tenant = await requirePublicTenantFromRequest(req)
  const customer = await requireCustomer()
  const ip = getClientIp(req)
  await enforceRateLimit(RATE_LIMITS.passwordResetRequest, scopedKey(tenant.arenaId, `verify:${customer.id}`))
  await parseJson(req, z.object({}).passthrough()).catch(() => ({}))
  const deliver = await requestEmailVerification(tenant.arenaId, customer.id, { ip })
  if (deliver) after(deliver)
  return ok(null, { message: "If your address still needs confirming, we've sent a new link." })
})
