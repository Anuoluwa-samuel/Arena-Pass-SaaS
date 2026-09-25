import { ok } from "@/server/http/response"
import { adminRoute, actorFrom } from "@/server/http/admin"
import { parseJson } from "@/server/http/request"
import { brandingSchema, getBranding, updateBranding } from "@/server/services/branding"

export const GET = adminRoute("settings.view", async (_req, _ctx, _user, arena) => ok(await getBranding(arena.arenaId)))

export const PATCH = adminRoute("settings.manage", async (req, _ctx, user, arena) => {
  // The arena is the operator's own, resolved from their membership. Nothing
  // in the body says which arena is being rebranded, and nothing could.
  const patch = await parseJson(req, brandingSchema.partial())
  const branding = await updateBranding(arena.arenaId, patch, { actor: actorFrom(user, req) })
  return ok(branding, { message: "Branding saved" })
})

export const dynamic = "force-dynamic"
