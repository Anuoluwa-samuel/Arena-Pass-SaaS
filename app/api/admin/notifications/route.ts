import { z } from "zod"
import { ok } from "@/server/http/response"
import { parseQuery, paginationSchema } from "@/server/http/request"
import { adminRoute } from "@/server/http/admin"
import { listNotifications } from "@/server/services/notifications"

export const GET = adminRoute("notifications.view", async (req, _ctx, _user, arena) => {
  const q = parseQuery(req, paginationSchema.extend({ status: z.string().optional(), channel: z.string().optional() }))
  const result = await listNotifications(arena.arenaId, q)
  return ok(result.items, { meta: result.meta })
})
