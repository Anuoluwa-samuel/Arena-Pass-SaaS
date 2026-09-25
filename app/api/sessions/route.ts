import { route, ok } from "@/server/http/response"
import { parseQuery } from "@/server/http/request"
import { sessionListQuerySchema } from "@/lib/validation/sessions"
import { listSessions } from "@/server/services/sessions"
import { requirePublicTenantFromRequest } from "@/server/tenant"
import { toPublicSession } from "@/server/serializers"

export const GET = route(async (req) => {
  const q = parseQuery(req, sessionListQuerySchema)
  const tenant = await requirePublicTenantFromRequest(req)
  const result = await listSessions({ arenaId: tenant.arenaId, publicOnly: true, q: q.q, from: q.from, to: q.to, page: q.page, pageSize: q.pageSize })
  return ok(result.items.map(toPublicSession), {
    meta: result.meta,
    headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60", Vary: "Host, X-Arena-Slug" },
  })
})
