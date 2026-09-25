import { ok } from "@/server/http/response"
import { parseJson, parseQuery } from "@/server/http/request"
import { adminRoute, actorFrom } from "@/server/http/admin"
import { sessionInputSchema, sessionListQuerySchema } from "@/lib/validation/sessions"
import { createSession, listSessions, syncSessionLifecycle } from "@/server/services/sessions"

export const GET = adminRoute("sessions.view", async (req, _ctx, _user, arena) => {
  const q = parseQuery(req, sessionListQuerySchema)
  await syncSessionLifecycle()
  const result = await listSessions({ arenaId: arena.arenaId, status: q.status, from: q.from, to: q.to, q: q.q, page: q.page, pageSize: q.pageSize, order: q.status === "completed" ? "desc" : "asc" })
  return ok(result.items, { meta: result.meta })
})

export const POST = adminRoute("sessions.manage", async (req, _ctx, user, arena) => {
  const input = await parseJson(req, sessionInputSchema)
  const session = await createSession(input, { arenaId: arena.arenaId, actor: actorFrom(user, req) })
  return ok(session, { status: 201, message: "Session created" })
})
