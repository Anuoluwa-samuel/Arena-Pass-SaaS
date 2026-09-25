import { Suspense } from "react"
import { redirect } from "next/navigation"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AdminSidebar } from "@/components/admin/admin-sidebar"
import { AdminHeader } from "@/components/admin/admin-header"
import { getCurrentUser } from "@/server/auth/session"
import { resolveAdminArena } from "@/server/tenant/admin-scope"
import { ArenaAccessDenied } from "@/components/admin/arena-access-denied"
import { ArenaTheme } from "@/components/site/arena-theme"
import { getBranding } from "@/server/services/branding"
import { ImpersonationBanner } from "@/components/admin/impersonation-banner"
import { AppError } from "@/server/http/errors"
import { getSettings } from "@/server/services/settings"

export const dynamic = "force-dynamic"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect("/admin/login")
  // The shell is rendered for one arena: the sidebar shows what this user may
  // do *here*, not the union of everything they may do somewhere.
  //
  // Being refused is a normal outcome, so it renders a screen rather than
  // escaping as a 500. The list offered back contains only arenas this user
  // is actually a member of.
  let arena
  try {
    arena = await resolveAdminArena(user)
  } catch (err) {
    if (err instanceof AppError && (err.code === "FORBIDDEN" || err.code === "ARENA_SELECTION_REQUIRED")) {
      const reason = err.code === "ARENA_SELECTION_REQUIRED" ? "choose" : user.memberships.length > 0 ? "no-access" : "none"
      return (
        <ArenaAccessDenied
          reason={reason}
          arenas={user.memberships.map((m) => ({ arenaId: m.arenaId, arenaName: m.arenaName, arenaSlug: m.arenaSlug, roleName: m.roleName }))}
          isPlatformStaff={Boolean(user.platform)}
        />
      )
    }
    throw err
  }
  const [settings, branding] = await Promise.all([getSettings(arena.arenaId), getBranding(arena.arenaId)])
  return (
    <SidebarProvider>
      {/* Staff who work across two arenas get a visible cue about which one
          they are in — the same colour their customers see. */}
      <ArenaTheme primaryColor={branding.primaryColor} accentColor={branding.accentColor} />
      <Suspense>
        <AdminSidebar permissions={arena.permissions} siteName={settings.siteName} />
      </Suspense>
      {/* Transparent so the page gradient reaches admin content and glass stat cards have something to frost. */}
      <SidebarInset className="min-w-0 bg-transparent">
        {arena.impersonated && arena.impersonationExpiresAt && (
          <ImpersonationBanner arenaName={arena.arenaName} expiresAt={arena.impersonationExpiresAt.toISOString()} />
        )}
        <AdminHeader
          user={{ name: user.name, email: user.email, roleName: arena.roleName }}
          arena={{ arenaId: arena.arenaId, arenaName: arena.arenaName, arenaSlug: arena.arenaSlug, roleName: arena.roleName }}
          // Only arenas this person is actually a member of.
          arenas={user.memberships.map((m) => ({ arenaId: m.arenaId, arenaName: m.arenaName, arenaSlug: m.arenaSlug, roleName: m.roleName }))}
        />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
