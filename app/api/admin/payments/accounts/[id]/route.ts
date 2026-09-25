import { ok } from "@/server/http/response"
import { adminRoute, actorFrom } from "@/server/http/admin"
import { deletePaymentAccount } from "@/server/payments/accounts"

export const DELETE = adminRoute("settings.manage", async (req, { params }, user, arena) => {
  const { id } = await params
  await deletePaymentAccount(arena.arenaId, id, { actor: actorFrom(user, req) })
  return ok(null, { message: "Payment account disconnected" })
})
