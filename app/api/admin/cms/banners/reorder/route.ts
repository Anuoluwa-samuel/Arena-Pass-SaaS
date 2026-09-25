import { z } from "zod"
import { ok } from "@/server/http/response"
import { parseJson } from "@/server/http/request"
import { adminRoute, actorFrom } from "@/server/http/admin"
import { reorder } from "@/server/services/cms"

export const POST = adminRoute("cms.manage", async (req, _ctx, user, arena) => {
  const { ids } = await parseJson(req, z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }))
  await reorder("banners", ids, { actor: actorFrom(user, req), arenaId: arena.arenaId })
  return ok(null, { message: "Order saved" })
})
