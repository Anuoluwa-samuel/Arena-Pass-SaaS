import { PageHeader } from "@/components/shared/page-header"
import { BannersEditor } from "@/components/admin/cms-collections"
import { requireArenaPermission } from "@/server/auth/rbac"
import { listBanners } from "@/server/services/cms"

export const metadata = { title: "Content · Banners" }

export default async function BannersContentPage() {
  const { arena } = await requireArenaPermission("cms.view")
  const rows = await listBanners(arena.arenaId)
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Content" title="Banners" description="The first active banner is shown on the homepage. Schedule them with start and end dates." />
      <BannersEditor items={rows.map((r) => r.banner)} canManage={arena.permissions.includes("cms.manage")} />
    </div>
  )
}
