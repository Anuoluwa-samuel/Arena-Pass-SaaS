import { ok } from "@/server/http/response"
import {adminRoute} from "@/server/http/admin"
import { getRecentActivity } from "@/server/services/analytics"

export const GET = adminRoute("dashboard.view", async (_req, _ctx, user, arena) => ok(await getRecentActivity(arena.arenaId)))
