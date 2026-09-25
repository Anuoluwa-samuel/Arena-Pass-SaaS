import { ok } from "@/server/http/response"
import { adminRoute, actorFrom } from "@/server/http/admin"
import { launchArena } from "@/server/services/onboarding"

/** Opens the arena to the public. Only an owner-level permission can do it. */
export const POST = adminRoute("settings.manage", async (req, _ctx, user, arena) => {
  const state = await launchArena(arena.arenaId, { actor: actorFrom(user, req) })
  return ok(state, { message: "Your arena is live" })
})
