import { z } from "zod"
import { ok } from "@/server/http/response"
import { parseJson } from "@/server/http/request"
import { adminRoute, actorFrom } from "@/server/http/admin"
import { refundPayment } from "@/server/services/payments"

export const POST = adminRoute("tickets.refund", async (req, { params }, user, arena) => {
  const { id } = await params
  const { reason } = await parseJson(req, z.object({ reason: z.string().trim().min(3).max(500) }))
  return ok(await refundPayment(arena.arenaId, id, reason, { actor: actorFrom(user, req) }), { message: "Refund issued" })
})
