import { ok } from "@/server/http/response"
import { adminRoute, actorFrom } from "@/server/http/admin"
import { publishSession } from "@/server/services/sessions"

export const POST = adminRoute("sessions.manage", async (req, { params }, user, arena) => {
  const { id } = await params
  return ok(await publishSession(arena.arenaId, id, { actor: actorFrom(user, req) }), { message: "Session published" })
})
