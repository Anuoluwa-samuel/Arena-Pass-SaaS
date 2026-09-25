import { PageHeader } from "@/components/shared/page-header"
import { ContactEditor } from "@/components/admin/cms-forms"
import { requireArenaPermission } from "@/server/auth/rbac"
import { getPage } from "@/server/services/cms"

export const metadata = { title: "Content · contact" }

export default async function ContactEditorPage() {
  const { arena } = await requireArenaPermission("cms.view")
  const page = await getPage(arena.arenaId, "contact")
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Content" title="Contact information" description="Edit the draft, preview, then publish. Autosave keeps your work safe." />
      <ContactEditor draft={page.draft} meta={{ hasUnpublishedChanges: page.hasUnpublishedChanges, publishedAt: page.publishedAt?.toISOString() ?? null, canManage: arena.permissions.includes("cms.manage") }} />
    </div>
  )
}
