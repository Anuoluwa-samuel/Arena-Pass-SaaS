import { z } from "zod"
import { ok } from "@/server/http/response"
import { parseQuery, paginationSchema } from "@/server/http/request"
import { adminRoute } from "@/server/http/admin"
import { listTickets } from "@/server/services/tickets"

export const GET = adminRoute("tickets.view", async (req, _ctx, _user, arena) => {
  const q = parseQuery(req, paginationSchema.extend({ status: z.string().optional(), sessionId: z.string().uuid().optional(), customerId: z.string().uuid().optional(), q: z.string().max(100).optional() }))
  const result = await listTickets(arena.arenaId, q)
  return ok(result.items, { meta: result.meta })
})
