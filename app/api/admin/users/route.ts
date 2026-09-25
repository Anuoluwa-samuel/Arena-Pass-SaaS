import { z } from "zod"
import { ok } from "@/server/http/response"
import { parseJson, parseQuery, paginationSchema } from "@/server/http/request"
import { adminRoute, actorFrom } from "@/server/http/admin"
import { createStaff, listStaff, staffInputSchema } from "@/server/services/users"

/** Staff of the arena this request resolved to — never staff of any other. */
export const GET = adminRoute("staff.view", async (req, _ctx, _user, arena) => {
  const q = parseQuery(req, paginationSchema.extend({ q: z.string().max(100).optional(), roleKey: z.string().optional() }))
  const result = await listStaff(arena.arenaId, q)
  return ok(result.items, { meta: result.meta })
})

export const POST = adminRoute("staff.invite", async (req, _ctx, user, arena) => {
  const input = await parseJson(req, staffInputSchema)
  const created = await createStaff(input, { arenaId: arena.arenaId, actor: actorFrom(user, req), actorRoleKey: arena.roleKey })
  return ok(created, { status: 201, message: "Staff member added" })
})
