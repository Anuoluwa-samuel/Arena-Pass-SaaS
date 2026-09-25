import { z } from "zod"
import { ok } from "@/server/http/response"
import { parseJson, getClientIp } from "@/server/http/request"
import { adminRoute, actorFrom } from "@/server/http/admin"
import { enforceRateLimit, RATE_LIMITS } from "@/server/http/rate-limit"
import { validateTicket } from "@/server/services/tickets"
import { toPublicTicket } from "@/server/serializers"

export const POST = adminRoute("tickets.validate", async (req, _ctx, user, arena) => {
  await enforceRateLimit(RATE_LIMITS.validate, `${user.id}:${getClientIp(req)}`)
  const body = await parseJson(req, z.object({ code: z.string().trim().min(3).max(300), mode: z.enum(["check", "admit"]).default("admit"), sessionId: z.string().uuid().optional() }))
  const outcome = await validateTicket(arena.arenaId, body.code, { mode: body.mode, expectedSessionId: body.sessionId, actor: actorFrom(user, req) })
  if (outcome.result === "INVALID") return ok({ result: "INVALID" })
  return ok({ result: outcome.result, reason: "reason" in outcome ? outcome.reason : undefined, ticket: toPublicTicket(outcome.ticket) })
})
