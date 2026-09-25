import { ok } from "@/server/http/response"
import { parseQuery, paginationSchema } from "@/server/http/request"
import { adminRoute } from "@/server/http/admin"
import { listTransactions } from "@/server/services/payments"

export const GET = adminRoute("payments.view", async (req, _ctx, _user, arena) => {
  const result = await listTransactions(arena.arenaId, parseQuery(req, paginationSchema))
  return ok(result.items, { meta: result.meta })
})
