import { ok } from "@/server/http/response"
import { parseJson } from "@/server/http/request"
import { adminRoute, actorFrom } from "@/server/http/admin"
import { listServices, createService, serviceInputSchema } from "@/server/services/cms"

export const GET = adminRoute("cms.view", async (_req, _ctx, user, arena) => ok(await listServices(arena.arenaId)))

export const POST = adminRoute("cms.manage", async (req, _ctx, user, arena) => {
  const input = await parseJson(req, serviceInputSchema)
  return ok(await createService(arena.arenaId, input, { actor: actorFrom(user, req) }), { status: 201, message: "Created" })
})
