import { Suspense } from "react"
import { ScrollText } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"
import { DataTable } from "@/components/admin/data-table"
import { FilterTabs, Pagination, SearchBox } from "@/components/admin/list-toolbar"
import { requireArenaPermission } from "@/server/auth/rbac"
import { listAuditLogs } from "@/server/services/analytics"
import { formatDateTime } from "@/lib/format"

export const metadata = { title: "Audit logs" }

export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { arena } = await requireArenaPermission("audit.view")
  const sp = await searchParams
  const result = await listAuditLogs(arena.arenaId, { q: sp.q, action: sp.action, page: Number(sp.page ?? 1), pageSize: 40 })
  return (
    <div className="space-y-6">
      <PageHeader title="Audit logs" description="Who did what, and when. Every administrative action is recorded." />
      <Suspense>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <FilterTabs param="action" options={[{ value: "all", label: "All" }, { value: "auth", label: "Auth" }, { value: "session", label: "Sessions" }, { value: "ticket", label: "Tickets" }, { value: "payment", label: "Payments" }, { value: "cms", label: "Content" }, { value: "user", label: "Users" }, { value: "settings", label: "Settings" }]} />
          <SearchBox placeholder="Search description or actor" className="md:w-80" />
        </div>
      </Suspense>
      <DataTable
        rows={result.items}
        rowKey={(r) => r.id}
        mobileTitle={(r) => r.description}
        empty={<EmptyState icon={ScrollText} title="No audit entries" />}
        columns={[
          { key: "when", header: "Time", cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt)}</span> },
          { key: "actor", header: "Actor", cell: (r) => <div><p>{r.actorName ?? "System"}</p><p className="text-xs text-muted-foreground">{r.actorType}{r.ipAddress ? ` · ${r.ipAddress}` : ""}</p></div> },
          { key: "action", header: "Action", cell: (r) => <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">{r.action}</code> },
          { key: "desc", header: "Description", hideOnMobile: true, cell: (r) => r.description },
          { key: "entity", header: "Entity", hideOnMobile: true, cell: (r) => (r.entityType ? <span className="text-xs text-muted-foreground">{r.entityType} · {r.entityId?.slice(0, 8)}</span> : null) },
        ]}
      />
      <Suspense><Pagination page={result.meta.page} totalPages={result.meta.totalPages} total={result.meta.total} pageSize={result.meta.pageSize} /></Suspense>
    </div>
  )
}
