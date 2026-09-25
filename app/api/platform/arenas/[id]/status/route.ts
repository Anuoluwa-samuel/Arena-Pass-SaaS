import { z } from "zod"
import { ok } from "@/server/http/response"
import { parseJson } from "@/server/http/request"
import { platformRoute, actorFrom } from "@/server/http/admin"
import { setArenaStatus } from "@/server/services/platform"

export const POST = platformRoute("platform.arenas.manage", async (req, { params }, user) => {
  const { id } = await params
  const { status, reason } = await parseJson(
    req,
    z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]), reason: z.string().trim().max(500).optional() })
  )
  const arena = await setArenaStatus(id, status, { actor: actorFrom(user, req), reason })
  return ok({ id: arena.id, status: arena.status }, { message: `Arena is now ${arena.status.toLowerCase()}` })
})
