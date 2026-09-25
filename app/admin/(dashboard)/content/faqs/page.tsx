import { PageHeader } from "@/components/shared/page-header"
import { FaqsEditor } from "@/components/admin/cms-collections"
import { requireArenaPermission } from "@/server/auth/rbac"
import { listFaqs } from "@/server/services/cms"

export const metadata = { title: "Content · FAQs" }

export default async function FaqsContentPage() {
  const { arena } = await requireArenaPermission("cms.view")
  const items = await listFaqs(arena.arenaId)
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Content" title="FAQs" description="Reorder with the arrows; hidden FAQs stay saved but are not shown on the site." />
      <FaqsEditor items={items} canManage={arena.permissions.includes("cms.manage")} />
    </div>
  )
}
