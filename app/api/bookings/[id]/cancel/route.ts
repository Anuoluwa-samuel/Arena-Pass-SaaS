import { route, ok } from "@/server/http/response"
import { assertSameOrigin, getClientIp } from "@/server/http/request"
import { cancelPendingBooking } from "@/server/services/bookings"
import { requirePublicTenantFromRequest } from "@/server/tenant"

export const POST = route(async (req, { params }) => {
  assertSameOrigin(req)
  const tenant = await requirePublicTenantFromRequest(req)
  const { id } = await params
  await cancelPendingBooking(tenant.arenaId, id, { actor: { type: "customer", ip: getClientIp(req) } })
  return ok(null, { message: "Reservation released" })
})
