import { after } from "next/server"
import { route, ok } from "@/server/http/response"
import { assertSameOrigin, getClientIp, parseJson } from "@/server/http/request"
import { enforceRateLimit, RATE_LIMITS, scopedKey } from "@/server/http/rate-limit"
import { forgotPasswordSchema } from "@/lib/validation/auth"
import { requestPasswordReset } from "@/server/auth/password-reset"
import { requirePublicTenantFromRequest } from "@/server/tenant"

export const POST = route(async (req) => {
  const tenant = await requirePublicTenantFromRequest(req)
  assertSameOrigin(req)
  const ip = getClientIp(req)
  await enforceRateLimit(RATE_LIMITS.passwordResetRequest, scopedKey(tenant.arenaId, ip))
  const body = await parseJson(req, forgotPasswordSchema)
  await enforceRateLimit(RATE_LIMITS.passwordResetRequest, scopedKey(tenant.arenaId, `email:${body.email.toLowerCase()}`))
  const deliver = await requestPasswordReset(tenant.arenaId, body.email, { ip, userAgent: req.headers.get("user-agent") })
  // Token issue + email happen after the response, so known and unknown emails respond identically.
  if (deliver) after(deliver)
  return ok(null, { message: "If an account exists for that email, we've sent a reset link." })
})
