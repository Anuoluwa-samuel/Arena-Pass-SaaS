import { route, ok } from "@/server/http/response"
import { assertSameOrigin, getClientIp, parseJson } from "@/server/http/request"
import { enforceRateLimit, RATE_LIMITS, scopedKey } from "@/server/http/rate-limit"
import { loginSchema } from "@/lib/validation/auth"
import { loginCustomer } from "@/server/auth/service"
import { requirePublicTenantFromRequest } from "@/server/tenant"

export const POST = route(async (req) => {
  const tenant = await requirePublicTenantFromRequest(req)
  assertSameOrigin(req)
  const ip = getClientIp(req)
  await enforceRateLimit(RATE_LIMITS.login, scopedKey(tenant.arenaId, ip))
  const body = await parseJson(req, loginSchema)
  await enforceRateLimit(RATE_LIMITS.login, `customer:${body.email.toLowerCase()}`)
  const customer = await loginCustomer(tenant.arenaId, body.email, body.password, { ip, userAgent: req.headers.get("user-agent") })
  return ok({ id: customer.id, name: customer.name, email: customer.email }, { message: "Signed in" })
})
