import { z } from "zod"
import { ok } from "@/server/http/response"
import { parseQuery } from "@/server/http/request"
import {adminRoute} from "@/server/http/admin"
import { getDashboardOverview } from "@/server/services/analytics"

export const GET = adminRoute(["dashboard.view"], async (req, _ctx, user, arena) => {
  const { days } = parseQuery(req, z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }))
  return ok(await getDashboardOverview(arena.arenaId, { days }))
})
