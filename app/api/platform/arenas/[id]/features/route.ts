import { z } from "zod"
import { ok } from "@/server/http/response"
import { parseJson } from "@/server/http/request"
import { platformRoute, actorFrom } from "@/server/http/admin"
import { listFeatureFlagsForArena, setFeatureFlag } from "@/server/services/platform"
import { FEATURE_FLAGS } from "@/lib/domain/constants"

export const GET = platformRoute("platform.arenas.view", async (_req, { params }) => {
  const { id } = await params
  return ok(await listFeatureFlagsForArena(id))
})

export const PUT = platformRoute("platform.arenas.manage", async (req, { params }, user) => {
  const { id } = await params
  const { flag, enabled } = await parseJson(req, z.object({ flag: z.enum(FEATURE_FLAGS), enabled: z.boolean() }))
  await setFeatureFlag(id, flag, enabled, { actor: actorFrom(user, req) })
  return ok(await listFeatureFlagsForArena(id), { message: `${flag} ${enabled ? "enabled" : "disabled"}` })
})
