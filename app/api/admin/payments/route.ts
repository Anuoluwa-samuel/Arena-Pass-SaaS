import { z } from "zod"
import { ok } from "@/server/http/response"
import { parseQuery, paginationSchema } from "@/server/http/request"
import { adminRoute } from "@/server/http/admin"
import { listPayments } from "@/server/services/payments"

export const GET = adminRoute("payments.view", async (req, _ctx, _user, arena) => {
  const q = parseQuery(req, paginationSchema.extend({ status: z.string().optional(), q: z.string().max(100).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }))
  const result = await listPayments(arena.arenaId, q)
  return ok(result.items, { meta: result.meta })
})
