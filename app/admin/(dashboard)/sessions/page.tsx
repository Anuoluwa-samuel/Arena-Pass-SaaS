import Link from "next/link"
import { Suspense } from "react"
import { CalendarPlus, CalendarX2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"
import { SessionStatusBadge } from "@/components/shared/status-badge"
import { DataTable } from "@/components/admin/data-table"
import { FilterTabs, Pagination, SearchBox } from "@/components/admin/list-toolbar"
import { SessionRowActions } from "@/components/admin/session-row-actions"
import { requireArenaPermission } from "@/server/auth/rbac"
import { listSessions, syncSessionLifecycle } from "@/server/services/sessions"
import { formatDateTime, formatMoney } from "@/lib/format"

export const metadata = { title: "Sessions" }

export default async function AdminSessionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { arena } = await requireArenaPermission("sessions.view")
  const sp = await searchParams
  await syncSessionLifecycle()
  const status = sp.status ?? "all"
  const result = await listSessions({ arenaId: arena.arenaId, status, q: sp.q, page: Number(sp.page ?? 1), pageSize: 20, order: status === "completed" || status === "CANCELLED" ? "desc" : "asc" })
  const canManage = arena.permissions.includes("sessions.manage")

  return (
    <div className="space-y-6">
      <PageHeader title="Sessions" description="Schedule sessions, control capacity and pricing, and watch bookings fill." actions={canManage && <Button asChild><Link href="/admin/sessions/new"><CalendarPlus className="mr-2 size-4" />Create session</Link></Button>} />
      <Suspense>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <FilterTabs options={[{ value: "all", label: "All" }, { value: "upcoming", label: "Upcoming" }, { value: "DRAFT", label: "Drafts" }, { value: "completed", label: "Completed" }, { value: "CANCELLED", label: "Cancelled" }]} />
          <SearchBox placeholder="Search title or venue" className="md:w-72" />
        </div>
      </Suspense>
      <DataTable
        rows={result.items}
        rowKey={(s) => s.id}
        mobileTitle={(s) => <Link href={`/admin/sessions/${s.id}`} className="hover:underline">{s.title}</Link>}
        empty={<EmptyState icon={CalendarX2} title="No sessions match" description="Try another filter, or create a new session." action={canManage ? <Button asChild><Link href="/admin/sessions/new">Create session</Link></Button> : undefined} />}
        columns={[
          { key: "title", header: "Session", hideOnMobile: true, cell: (s) => <div className="min-w-0"><Link href={`/admin/sessions/${s.id}`} className="font-medium hover:underline">{s.title}</Link><p className="truncate text-xs text-muted-foreground">{s.venue}</p></div> },
          { key: "when", header: "Kick-off", cell: (s) => <span className="whitespace-nowrap">{formatDateTime(s.startsAt)}</span> },
          { key: "capacity", header: "Booked", cell: (s) => <div className="min-w-24"><span className="tabular-nums">{s.bookedCount}/{s.totalCapacity}</span>{s.heldCount > 0 && <span className="ml-1 text-xs text-warning">+{s.heldCount} held</span>}<div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary" style={{ width: `${Math.round((s.bookedCount / s.totalCapacity) * 100)}%` }} /></div></div> },
          { key: "format", header: "Format", cell: (s) => `${s.teamsCount} × ${s.playersPerTeam}` },
          { key: "price", header: "Price", cell: (s) => formatMoney(s.ticketPrice, s.currency) },
          { key: "status", header: "Status", cell: (s) => <SessionStatusBadge status={s.effectiveStatus} /> },
          { key: "actions", header: "", className: "w-12 text-right", mobileHeader: true, cell: (s) => <SessionRowActions session={{ id: s.id, title: s.title, status: s.status, bookedCount: s.bookedCount }} canManage={canManage} /> },
        ]}
      />
      <Suspense>
        <Pagination page={result.meta.page} totalPages={result.meta.totalPages} total={result.meta.total} pageSize={result.meta.pageSize} />
      </Suspense>
    </div>
  )
}
