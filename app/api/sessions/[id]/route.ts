import { route, ok } from "@/server/http/response"
import { getSessionWithTeams } from "@/server/services/sessions"
import { toPublicSession, toPublicTeams } from "@/server/serializers"
import { requirePublicTenantFromRequest } from "@/server/tenant"

export const GET = route(async (req, { params }) => {
  const tenant = await requirePublicTenantFromRequest(req)
  const { id } = await params
  const { session, teams } = await getSessionWithTeams(tenant.arenaId, id)
  return ok({ ...toPublicSession(session), teams: toPublicTeams(teams) }, { headers: { "Cache-Control": "no-store" } })
})
