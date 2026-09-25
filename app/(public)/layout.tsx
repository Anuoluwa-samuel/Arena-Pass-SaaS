import { cookies } from "next/headers"
import { SiteHeader } from "@/components/site/site-header"
import { SiteFooter } from "@/components/site/site-footer"
import { SiteFooterSlim } from "@/components/site/site-footer-slim"
import { PublicFooter } from "@/components/site/public-footer"
import { CustomerShell } from "@/components/site/customer-shell"
import { getCurrentCustomer } from "@/server/auth/session"
import { getPublicSiteContent } from "@/server/services/public-content"
import { SIDEBAR_COOKIE } from "@/lib/sidebar"
import { FloodlightBackdrop } from "@/components/site/floodlight-backdrop"
import { ArenaTheme } from "@/components/site/arena-theme"
import { ScrollProgress } from "@/components/scroll-progress"
import { getTenantContext, requirePublicTenantOrPlatformHome } from "@/server/tenant"
import { getSettings } from "@/server/services/settings"

/**
 * The storefront is the arena's own site, so its document title carries the
 * arena's name — not the platform's. This overrides the root layout's
 * template for everything under `(public)`.
 */
export async function generateMetadata() {
  const tenant = await getTenantContext()
  // The platform's own front door, rather than any arena's storefront.
  if (!tenant) return { title: { absolute: "Arena Pass — run your own arena" } }
  const settings = await getSettings(tenant.arenaId)
  const name = settings.siteName || tenant.arena.name
  // `absolute` so the root layout's "%s · Arena Pass" template does not wrap
  // the arena's own name; `template` still applies to pages beneath this one.
  return { title: { absolute: name, template: `%s \u00b7 ${name}` } }
}

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const tenant = await requirePublicTenantOrPlatformHome()
  // No arena answers this hostname, and the path is the root: this is the
  // platform's own welcome page, which has no arena chrome to wrap it in — no
  // site name, no branding, no contact details, because there is no arena.
  if (!tenant) return <>{children}</>

  const [content, customer] = await Promise.all([getPublicSiteContent(tenant.arenaId), getCurrentCustomer()])

  // Signed-in customers get the glass side navigation and no footer; visitors keep the top navbar,
  // plus the full footer on the landing page and the slim bar everywhere else.
  if (customer) {
    const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed"
    return (
      <>
        <ArenaTheme primaryColor={content.branding.primaryColor} accentColor={content.branding.accentColor} />
        <FloodlightBackdrop />
        <ScrollProgress />
        <CustomerShell customer={{ name: customer.name, email: customer.email, username: customer.username }} siteName={content.siteName} initialCollapsed={collapsed}>
          {children}
        </CustomerShell>
      </>
    )
  }

  return (
    <div className="flex min-h-screen flex-col">
      <ArenaTheme primaryColor={content.branding.primaryColor} accentColor={content.branding.accentColor} />
      <FloodlightBackdrop />
      <ScrollProgress />
      <SiteHeader siteName={content.siteName} logoUrl={content.branding.logoUrl} />
      <div className="flex-1">{children}</div>
      <PublicFooter
        full={<SiteFooter siteName={content.siteName} contact={content.contact} />}
        slim={<SiteFooterSlim siteName={content.siteName} />}
      />
    </div>
  )
}
