import { route, ok } from "@/server/http/response"
import { getPublicSiteContent } from "@/server/services/public-content"
import { requirePublicTenantFromRequest } from "@/server/tenant"

/**
 * One arena's public content.
 *
 * The response is entirely determined by which arena the request resolved to,
 * so every input that can select a tenant is named in `Vary`. Shared caches
 * key on the host already; saying so explicitly means a cache that does not
 * cannot serve one arena's branding to another. Resolving the tenant reads
 * request headers, which also keeps this handler out of the static build.
 */
export const GET = route(async (req) => {
  const tenant = await requirePublicTenantFromRequest(req)
  return ok(await getPublicSiteContent(tenant.arenaId), {
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300", Vary: "Host, X-Arena-Slug" },
  })
})
