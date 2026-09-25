import "server-only"
import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { getTenantContext, type TenantContext } from "./context"
import { isPlatformHost } from "./resolver"

/**
 * Tenant helpers for server components.
 *
 * Separate from `./context` because they import `next/navigation`, and the
 * context module is loaded by the session loader — which also runs in seed
 * scripts and tests, where that import cannot be resolved.
 */

/**
 * The tenant for a customer-facing page. An address that matches no live arena
 * renders the 404 page rather than throwing, because a page has no error
 * envelope to put a code in. A dedicated "arena suspended" screen arrives with
 * the storefront work; until then a suspended arena is a 404 here, while the
 * API still answers 503.
 */
export async function requirePublicTenantForPage(): Promise<TenantContext> {
  const tenant = await getTenantContext()
  if (!tenant || tenant.arena.status !== "ACTIVE") notFound()
  return tenant
}

/** The tenant for an admin page: an arena still in onboarding is reachable. */
export async function requireTenantContextForPage(): Promise<TenantContext> {
  const tenant = await getTenantContext()
  if (!tenant || tenant.arena.status === "ARCHIVED") notFound()
  return tenant
}

/**
 * The tenant for the storefront root, or `null` when this hostname belongs to
 * no arena and the caller should render the platform's own welcome page.
 *
 * Two conditions, both required. The hostname must be the platform's own —
 * the root domain or its `www` form, never a subdomain that simply matched no
 * arena, which stays the dead end the resolver makes it. And the path must be
 * the root: `/sessions`, `/login`, a ticket and a checkout callback are all
 * meaningful only inside an arena, so on a hostname with no arena they are
 * 404s. Those five pages under `(public)` have no tenant guard of their own
 * and rely on this one.
 *
 * A deployment with exactly one arena still resolves that arena here, so the
 * single-arena installation this application grew out of keeps its own site on
 * its own domain rather than being replaced by platform marketing.
 */
export async function requirePublicTenantOrPlatformHome(): Promise<TenantContext | null> {
  const tenant = await getTenantContext()
  // A suspended or archived arena is a 404 wherever it is addressed; falling
  // through to the welcome page would tell the world the arena had been shut
  // off, which is the arena's business and not a visitor's.
  if (tenant) return tenant.arena.status === "ACTIVE" ? tenant : notFound()
  const requestHeaders = await headers()
  const pathname = requestHeaders.get("x-pathname") ?? "/"
  if (pathname !== "/") notFound()
  if (!isPlatformHost(requestHeaders.get("host"))) notFound()
  return null
}
