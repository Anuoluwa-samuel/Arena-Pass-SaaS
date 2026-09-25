import { PageHeader } from "@/components/shared/page-header"
import { AnnouncementsEditor } from "@/components/admin/cms-collections"
import { requireArenaPermission } from "@/server/auth/rbac"
import { listAnnouncements } from "@/server/services/cms"

export const metadata = { title: "Content · Announcements" }

export default async function AnnouncementsContentPage() {
  const { arena } = await requireArenaPermission("cms.view")
  const { items } = await listAnnouncements(arena.arenaId, { pageSize: 100 })
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Content" title="Announcements" description="Published announcements within their dates appear as a strip at the top of the homepage." />
      <AnnouncementsEditor items={items.map((a) => ({ ...a, isActive: a.status === "PUBLISHED" }))} canManage={arena.permissions.includes("cms.manage")} />
    </div>
  )
}
