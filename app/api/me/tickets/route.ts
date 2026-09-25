import { route, ok } from "@/server/http/response"
import { requireCustomer } from "@/server/auth/rbac"
import { listTickets } from "@/server/services/tickets"
import { requirePublicTenantFromRequest } from "@/server/tenant"

export const GET = route(async (req) => {
  const tenant = await requirePublicTenantFromRequest(req)
  const customer = await requireCustomer()
  const result = await listTickets(tenant.arenaId, { customerId: customer.id, pageSize: 100 })
  return ok(result.items.map(({ ticket, session, slot }) => ({ id: ticket.id, ticketNumber: ticket.ticketNumber, status: ticket.status, playerName: ticket.playerName, price: ticket.price, currency: ticket.currency, purchasedAt: ticket.purchasedAt, session, slot })), { headers: { "Cache-Control": "private, no-store" } })
})
