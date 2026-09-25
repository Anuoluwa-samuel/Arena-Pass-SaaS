import { ok } from "@/server/http/response"
import { adminRoute } from "@/server/http/admin"
import { listBookingsForSession } from "@/server/services/bookings"

export const GET = adminRoute("sessions.view", async (_req, { params }, _user, arena) => {
  const { id } = await params
  return ok(await listBookingsForSession(arena.arenaId, id))
})
