import { route, ok } from "@/server/http/response"
import { assertSameOrigin, getClientIp, parseJson } from "@/server/http/request"
import { enforceRateLimit, RATE_LIMITS, scopedKey } from "@/server/http/rate-limit"
import { createBookingSchema } from "@/lib/validation/bookings"
import { createBooking } from "@/server/services/bookings"
import { initializePayment } from "@/server/services/payments"
import { toPublicBooking } from "@/server/serializers"
import { requirePublicTenantFromRequest } from "@/server/tenant"
import { requireCustomer } from "@/server/auth/rbac"

/**
 * Reserve a slot and start payment in one call so the customer sees a single
 * step.
 *
 * Two things never come from the body. The **arena** comes from the storefront
 * the request was made to, so a session id belonging to another arena is
 * simply not found. The **customer** comes from the signed-in session, so a
 * slot can only ever be reserved by the person reserving it — booking as
 * somebody else is not something the API can express.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req)
  const tenant = await requirePublicTenantFromRequest(req)
  const ip = getClientIp(req)
  await enforceRateLimit(RATE_LIMITS.booking, scopedKey(tenant.arenaId, ip))
  const customer = await requireCustomer()
  const body = await parseJson(req, createBookingSchema)
  const created = await createBooking(tenant.arenaId, body, {
    actor: { type: "customer", id: customer.id, name: customer.name, ip },
    customerId: customer.id,
  })
  const { authorizationUrl, payment } = await initializePayment(tenant.arenaId, created.booking.id)
  return ok({ booking: toPublicBooking(created), payment: { reference: payment.reference, authorizationUrl } }, { status: created.reused ? 200 : 201, message: "Slot reserved" })
})
