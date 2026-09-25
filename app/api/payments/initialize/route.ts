import { z } from "zod"
import { route, ok } from "@/server/http/response"
import { assertSameOrigin, parseJson } from "@/server/http/request"
import { initializePayment } from "@/server/services/payments"
import { requirePublicTenantFromRequest } from "@/server/tenant"

export const POST = route(async (req) => {
  assertSameOrigin(req)
  const tenant = await requirePublicTenantFromRequest(req)
  const { bookingId } = await parseJson(req, z.object({ bookingId: z.string().uuid() }))
  const { payment, authorizationUrl } = await initializePayment(tenant.arenaId, bookingId)
  return ok({ reference: payment.reference, authorizationUrl })
})
