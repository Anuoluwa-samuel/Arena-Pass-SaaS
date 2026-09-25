import { ok } from "@/server/http/response"
import { parseJson } from "@/server/http/request"
import { adminRoute, actorFrom } from "@/server/http/admin"
import { removeStaff, updateStaff, staffInputSchema } from "@/server/services/users"

/**
 * The id in the path is only a lookup hint. `updateStaff` / `removeStaff`
 * resolve the membership within the resolved arena first, so an id belonging
 * to another arena's staff reads as "not found".
 */
export const PATCH = adminRoute("staff.update", async (req, { params }, user, arena) => {
  const { id } = await params
  const input = await parseJson(req, staffInputSchema.partial())
  const updated = await updateStaff(id, input, { arenaId: arena.arenaId, actor: actorFrom(user, req), actorRoleKey: arena.roleKey })
  return ok(updated, { message: "Staff member updated" })
})

export const DELETE = adminRoute("staff.remove", async (req, { params }, user, arena) => {
  const { id } = await params
  await removeStaff(id, { arenaId: arena.arenaId, actor: actorFrom(user, req), actorRoleKey: arena.roleKey })
  return ok(null, { message: "Removed from this arena" })
})
