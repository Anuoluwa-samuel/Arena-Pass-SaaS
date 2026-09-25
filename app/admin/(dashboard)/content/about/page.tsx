import { PageHeader } from "@/components/shared/page-header"
import { AboutEditor } from "@/components/admin/cms-forms"
import { requireArenaPermission } from "@/server/auth/rbac"
import { getPage } from "@/server/services/cms"

export const metadata = { title: "Content · about" }

export default async function AboutEditorPage() {
  const { arena } = await requireArenaPermission("cms.view")
  const page = await getPage(arena.arenaId, "about")
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Content" title="About page" description="Edit the draft, preview, then publish. Autosave keeps your work safe." />
      <AboutEditor draft={page.draft} meta={{ hasUnpublishedChanges: page.hasUnpublishedChanges, publishedAt: page.publishedAt?.toISOString() ?? null, canManage: arena.permissions.includes("cms.manage") }} />
    </div>
  )
}
