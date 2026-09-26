import { ok } from "@/server/http/response"
import { adminRoute } from "@/server/http/admin"
import { getBillingSummaryForArena } from "@/server/services/billing"

/**
 * The organization's subscription, read through the arena the operator is
 * working in. The arena comes from their membership, so an operator can only
 * ever reach the billing of an organization they have an arena in.
 */
export const GET = adminRoute("billing.view", async (_req, _ctx, _user, arena) =>
  ok(await getBillingSummaryForArena(arena.arenaId))
)

export const dynamic = "force-dynamic"
