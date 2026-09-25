import { route, ok } from "@/server/http/response"
import { assertSameOrigin, getClientIp, parseJson } from "@/server/http/request"
import { enforceRateLimit, RATE_LIMITS, scopedKey } from "@/server/http/rate-limit"
import { loginSchema } from "@/lib/validation/auth"
import { loginUser } from "@/server/auth/service"
import { getTenantContextFromRequest } from "@/server/tenant"

export const POST = route(async (req) => {
  assertSameOrigin(req)
  const ip = getClientIp(req)
  // Nullable: the platform sign-in page is addressed to no arena, and those
  // attempts share a "platform" bucket of their own.
  const tenant = await getTenantContextFromRequest(req)
  await enforceRateLimit(RATE_LIMITS.login, scopedKey(tenant?.arenaId, ip))
  const body = await parseJson(req, loginSchema)
  await enforceRateLimit(RATE_LIMITS.login, scopedKey(tenant?.arenaId, `email:${body.email.toLowerCase()}`))
  const user = await loginUser(body.email, body.password, { ip, userAgent: req.headers.get("user-agent"), arenaId: tenant?.arenaId ?? null })
  return ok(user, { message: "Signed in" })
})
