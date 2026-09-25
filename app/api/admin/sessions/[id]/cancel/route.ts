import { z } from "zod"
import { ok } from "@/server/http/response"
import { parseJson } from "@/server/http/request"
import { adminRoute, actorFrom } from "@/server/http/admin"
import { cancelSession } from "@/server/services/sessions"

export const POST = adminRoute("sessions.manage", async (req, { params }, user, arena) => {
  const { id } = await params
  const { reason } = await parseJson(req, z.object({ reason: z.string().trim().min(3).max(500) }))
  return ok(await cancelSession(arena.arenaId, id, reason, { actor: actorFrom(user, req) }), { message: "Session cancelled" })
})
