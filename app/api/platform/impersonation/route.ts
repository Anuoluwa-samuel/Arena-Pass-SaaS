import { z } from "zod"
import { ok } from "@/server/http/response"
import { parseJson } from "@/server/http/request"
import { platformRoute, actorFrom } from "@/server/http/admin"
import { endImpersonation, startImpersonation, IMPERSONATION_TTL_MS } from "@/server/services/platform"
import { setSelectedArenaCookie } from "@/server/tenant/admin-scope"

/**
 * Starts a time-limited, read-only look inside one arena. The reason is
 * required and recorded: this is the only route across the platform/tenant
 * line, and it should be uncomfortable enough that nobody uses it casually.
 */
export const POST = platformRoute("platform.impersonate", async (req, _ctx, user) => {
  const { arenaId, reason } = await parseJson(req, z.object({ arenaId: z.string().uuid(), reason: z.string().trim().min(5).max(500) }))
  const impersonation = await startImpersonation(user.id, arenaId, { reason, actor: actorFrom(user, req) })
  // Land them in that arena rather than making them pick it again.
  await setSelectedArenaCookie(arenaId)
  return ok(
    { arenaId, expiresAt: impersonation.expiresAt, minutes: IMPERSONATION_TTL_MS / 60_000 },
    { message: "You are now viewing this arena, read-only" }
  )
})

export const DELETE = platformRoute("platform.impersonate", async (req, _ctx, user) => {
  await endImpersonation(user.id, { actor: actorFrom(user, req) })
  return ok(null, { message: "Stopped viewing that arena" })
})
