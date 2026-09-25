import { z } from "zod"
import { route, ok } from "@/server/http/response"
import { parseQuery } from "@/server/http/request"
import { verifyPayment } from "@/server/services/payments"
import { ticketAccessKey } from "@/server/serializers"
import { requirePublicTenantFromRequest } from "@/server/tenant"

/** Called by the callback page after the provider redirects back. Server-side verification only. */
export const GET = route(async (req) => {
  const tenant = await requirePublicTenantFromRequest(req)
  const { reference } = parseQuery(req, z.object({ reference: z.string().min(4).max(64) }))
  const outcome = await verifyPayment(tenant.arenaId, reference)
  if (outcome.status === "PAID") {
    return ok({ status: "PAID", ticketNumber: outcome.ticket.ticketNumber, accessKey: ticketAccessKey(outcome.ticket.ticketNumber) })
  }
  if (outcome.status === "REFUND_REQUIRED") {
    return ok({ status: "REFUND_REQUIRED", reason: "Your payment went through, but the session filled up before it was confirmed, so no ticket was issued. Our team has been alerted and will refund you in full.", bookingId: null })
  }
  return ok({ status: outcome.status, reason: outcome.status === "FAILED" ? outcome.payment.failureReason : null, bookingId: outcome.payment.bookingId })
})
