import { z } from "zod"
import { ok } from "@/server/http/response"
import { platformRoute, actorFrom } from "@/server/http/admin"
import { parseJson } from "@/server/http/request"
import { listPlans, listSubscriptions, setSubscriptionPlan } from "@/server/services/billing"

export const GET = platformRoute("platform.subscriptions.view", async () =>
  ok({ subscriptions: await listSubscriptions(), plans: await listPlans({ includePrivate: true }) })
)

/**
 * Moves one organization to another plan — comping a venue, or applying a
 * negotiated tier. Recorded as a subscription event and an audit entry,
 * because these are the operations most worth being able to explain later.
 */
export const PATCH = platformRoute("platform.subscriptions.manage", async (req, _ctx, user) => {
  const body = await parseJson(
    req,
    z.object({ organizationId: z.string().uuid(), planKey: z.string().min(1), reason: z.string().trim().max(500).optional() })
  )
  const summary = await setSubscriptionPlan(body.organizationId, body.planKey, {
    actor: actorFrom(user, req),
    reason: body.reason,
  })
  return ok(summary, { message: "Plan updated" })
})

export const dynamic = "force-dynamic"
