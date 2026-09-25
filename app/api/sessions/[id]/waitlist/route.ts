import { route, ok } from "@/server/http/response"
import { assertSameOrigin, getClientIp, parseJson } from "@/server/http/request"
import { enforceRateLimit, RATE_LIMITS, scopedKey } from "@/server/http/rate-limit"
import { waitlistSchema } from "@/lib/validation/bookings"
import { joinWaitlist } from "@/server/services/sessions"
import { requirePublicTenantFromRequest } from "@/server/tenant"

export const POST = route(async (req, { params }) => {
  assertSameOrigin(req)
  const tenant = await requirePublicTenantFromRequest(req)
  await enforceRateLimit(RATE_LIMITS.signup, scopedKey(tenant.arenaId, getClientIp(req)))
  const { id } = await params
  const body = await parseJson(req, waitlistSchema)
  await joinWaitlist(tenant.arenaId, id, body)
  return ok(null, { message: "You're on the waitlist. We'll email you if a slot opens up." })
})
