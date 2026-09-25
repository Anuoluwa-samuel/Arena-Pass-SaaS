import { z } from "zod"
import { ok } from "@/server/http/response"
import { parseQuery, paginationSchema } from "@/server/http/request"
import { adminRoute } from "@/server/http/admin"
import { listCustomers } from "@/server/services/customers"

export const GET = adminRoute("customers.view", async (req, _ctx, _user, arena) => {
  const q = parseQuery(req, paginationSchema.extend({ q: z.string().max(100).optional() }))
  const result = await listCustomers(arena.arenaId, q)
  return ok(result.items, { meta: result.meta })
})
