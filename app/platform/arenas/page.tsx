import { PageHeader } from "@/components/shared/page-header"
import { PlatformArenasTable } from "@/components/admin/platform-arenas-table"
import { requirePlatformPermission } from "@/server/auth/rbac"
import { listPlatformArenas } from "@/server/services/platform"

export const metadata = { title: "Arenas" }

export default async function PlatformArenasPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { platform } = await requirePlatformPermission("platform.arenas.view")
  const sp = await searchParams
  const arenas = await listPlatformArenas({ q: sp.q, status: sp.status })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Arenas"
        description="Every tenant on the platform. Suspending one closes its storefront immediately; its operators keep admin access so they can put it right."
      />
      <PlatformArenasTable
        arenas={arenas.map((a) => ({
          id: a.id,
          slug: a.slug,
          name: a.name,
          status: a.status,
          organizationName: a.organizationName,
          members: a.members,
          sessions: a.sessions,
          launchedAt: a.launchedAt?.toISOString() ?? null,
        }))}
        canManage={platform.permissions.includes("platform.arenas.manage")}
        canImpersonate={platform.permissions.includes("platform.impersonate")}
      />
    </div>
  )
}
