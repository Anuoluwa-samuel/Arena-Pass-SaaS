import { PageHeader } from "@/components/shared/page-header"
import { HomepageEditor } from "@/components/admin/cms-forms"
import { requireArenaPermission } from "@/server/auth/rbac"
import { getPage } from "@/server/services/cms"

export const metadata = { title: "Content · homepage" }

export default async function HomepageEditorPage() {
  const { arena } = await requireArenaPermission("cms.view")
  const page = await getPage(arena.arenaId, "homepage")
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Content" title="Homepage" description="Edit the draft, preview, then publish. Autosave keeps your work safe." />
      <HomepageEditor draft={page.draft} meta={{ hasUnpublishedChanges: page.hasUnpublishedChanges, publishedAt: page.publishedAt?.toISOString() ?? null, canManage: arena.permissions.includes("cms.manage") }} />
    </div>
  )
}
