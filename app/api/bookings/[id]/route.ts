import { route, ok } from "@/server/http/response"
import { getBookingById } from "@/server/services/bookings"
import { toPublicBookingDetail } from "@/server/serializers"
import { requirePublicTenantFromRequest } from "@/server/tenant"

export const GET = route(async (req, { params }) => {
  const tenant = await requirePublicTenantFromRequest(req)
  const { id } = await params
  return ok(toPublicBookingDetail(await getBookingById(tenant.arenaId, id)), { headers: { "Cache-Control": "no-store" } })
})
