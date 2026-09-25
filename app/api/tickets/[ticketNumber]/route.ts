import { route, ok } from "@/server/http/response"
import { getTicketByNumber, qrDataUrl } from "@/server/services/tickets"
import { getCurrentCustomer, getCurrentUser } from "@/server/auth/session"
import { canInArena } from "@/server/tenant/authorization"
import { forbidden } from "@/server/http/errors"
import { ticketAccessKey, toPublicTicket } from "@/server/serializers"
import { safeEqual } from "@/server/auth/tokens"

/**
 * A ticket is visible to its owner (customer session), to staff *of the arena
 * that issued it*, or to anyone holding the signed access key embedded in the
 * ticket link. A ticket agent in another arena has no business here, so the
 * permission is checked against the ticket's own arena rather than the
 * caller's.
 */
export const GET = route(async (req, { params }) => {
  const { ticketNumber } = await params
  const detail = await getTicketByNumber(ticketNumber.toUpperCase())
  const key = new URL(req.url).searchParams.get("k") ?? ""
  const [customer, user] = await Promise.all([getCurrentCustomer(), getCurrentUser()])
  const allowed = (customer && customer.id === detail.ticket.customerId) || (user && canInArena(user, detail.ticket.arenaId, "tickets.view")) || (key && safeEqual(key, ticketAccessKey(detail.ticket.ticketNumber)))
  if (!allowed) throw forbidden("You do not have access to this ticket")
  return ok({ ...toPublicTicket(detail), qrImage: await qrDataUrl(detail.ticket) }, { headers: { "Cache-Control": "private, no-store" } })
})
