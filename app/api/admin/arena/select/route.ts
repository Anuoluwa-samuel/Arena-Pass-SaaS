import { z } from "zod"
import { ok } from "@/server/http/response"
import { route } from "@/server/http/response"
import { assertSameOrigin, parseJson } from "@/server/http/request"
import { requireUser } from "@/server/auth/rbac"
import { setSelectedArenaCookie } from "@/server/tenant/admin-scope"
import { AppError } from "@/server/http/errors"

/**
 * Remembers which arena an operator is working on.
 *
 * The choice is validated against their memberships here *and* again on every
 * read, so a tampered cookie selects nothing rather than something.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req)
  const user = await requireUser()
  const { arenaId } = await parseJson(req, z.object({ arenaId: z.string().uuid() }))
  const membership = user.memberships.find((m) => m.arenaId === arenaId)
  if (!membership) throw new AppError("FORBIDDEN", "You are not a member of that arena")
  await setSelectedArenaCookie(arenaId)
  return ok({ arenaId, arenaSlug: membership.arenaSlug }, { message: `Switched to ${membership.arenaName}` })
})
