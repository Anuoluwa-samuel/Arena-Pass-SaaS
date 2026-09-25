import { after } from "next/server"
import { route, ok } from "@/server/http/response"
import { assertSameOrigin, getClientIp, parseJson } from "@/server/http/request"
import { enforceRateLimit, RATE_LIMITS, scopedKey } from "@/server/http/rate-limit"
import { signupSchema } from "@/lib/validation/auth"
import { signupCustomer } from "@/server/auth/service"
import { requestEmailVerification } from "@/server/auth/email-verification"
import { requirePublicTenantFromRequest } from "@/server/tenant"

export const POST = route(async (req) => {
  const tenant = await requirePublicTenantFromRequest(req)
  assertSameOrigin(req)
  const ip = getClientIp(req)
  await enforceRateLimit(RATE_LIMITS.signup, scopedKey(tenant.arenaId, ip))
  const body = await parseJson(req, signupSchema)
  const customer = await signupCustomer(tenant.arenaId, { ...body, phone: body.phone || undefined }, { ip, userAgent: req.headers.get("user-agent") })
  // Issued and sent after the response: signing up should not wait on an SMTP
  // round trip, and an unverified address still books — verification gates
  // nothing today beyond the badge on the profile.
  const deliver = await requestEmailVerification(tenant.arenaId, customer.id, { ip })
  if (deliver) after(deliver)
  return ok({ id: customer.id, name: customer.name, email: customer.email }, { message: "Account created", status: 201 })
})
