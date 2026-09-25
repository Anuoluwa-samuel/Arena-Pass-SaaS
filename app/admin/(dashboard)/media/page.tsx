import { Suspense } from "react"
import { PageHeader } from "@/components/shared/page-header"
import { MediaLibrary } from "@/components/admin/media-library"
import { FilterTabs, Pagination, SearchBox } from "@/components/admin/list-toolbar"
import { requireArenaPermission } from "@/server/auth/rbac"
import { listMedia } from "@/server/services/media"

export const metadata = { title: "Media library" }

export default async function MediaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { arena } = await requireArenaPermission("media.view")
  const sp = await searchParams
  const result = await listMedia(arena.arenaId, { folder: sp.folder, q: sp.q, page: Number(sp.page ?? 1), pageSize: 40 })
  return (
    <div className="space-y-6">
      <PageHeader title="Media library" description="Images used across the site. Uploads are stored in object storage, never in the database." />
      <Suspense>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <FilterTabs param="folder" options={[{ value: "all", label: "All folders" }, ...result.folders.map((f) => ({ value: f, label: f }))]} />
          <SearchBox placeholder="Search file name or alt text" className="md:w-72" />
        </div>
      </Suspense>
      <MediaLibrary items={result.items.map((m) => ({ id: m.id, url: m.url, originalName: m.originalName, altText: m.altText, folder: m.folder, mimeType: m.mimeType, sizeBytes: m.sizeBytes, width: m.width, height: m.height, createdAt: m.createdAt.toISOString() }))} canManage={arena.permissions.includes("media.manage")} />
      <Suspense><Pagination page={result.meta.page} totalPages={result.meta.totalPages} total={result.meta.total} pageSize={result.meta.pageSize} /></Suspense>
    </div>
  )
}
