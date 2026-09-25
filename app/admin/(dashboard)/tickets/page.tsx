import Link from "next/link"
import { Suspense } from "react"
import { Ticket } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"
import { TicketStatusBadge } from "@/components/shared/status-badge"
import { DataTable } from "@/components/admin/data-table"
import { FilterTabs, Pagination, SearchBox } from "@/components/admin/list-toolbar"
import { TicketRowActions } from "@/components/admin/ticket-row-actions"
import { requireArenaPermission } from "@/server/auth/rbac"
import { listTickets } from "@/server/services/tickets"
import { formatDateTime, formatMoney } from "@/lib/format"

export const metadata = { title: "Tickets" }

export default async function AdminTicketsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { arena } = await requireArenaPermission("tickets.view")
  const sp = await searchParams
  const result = await listTickets(arena.arenaId, { status: sp.status, q: sp.q, sessionId: sp.sessionId, page: Number(sp.page ?? 1), pageSize: 25 })
  return (
    <div className="space-y-6">
      <PageHeader title="Tickets" description="Every ticket issued, with its payment and entry status." />
      <Suspense>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <FilterTabs options={[{ value: "all", label: "All" }, { value: "CONFIRMED", label: "Sold" }, { value: "USED", label: "Used" }, { value: "REFUNDED", label: "Refunded" }, { value: "CANCELLED", label: "Cancelled" }]} />
          <SearchBox placeholder="Ticket number, name or email" className="md:w-80" />
        </div>
      </Suspense>
      <DataTable
        rows={result.items}
        rowKey={(r) => r.ticket.id}
        mobileTitle={(r) => <span className="font-mono">{r.ticket.ticketNumber}</span>}
        empty={<EmptyState icon={Ticket} title="No tickets found" description="Tickets appear here as soon as a payment is confirmed." />}
        columns={[
          { key: "number", header: "Ticket", hideOnMobile: true, cell: (r) => <Link href={`/tickets/${r.ticket.ticketNumber}`} target="_blank" className="font-mono text-sm hover:underline">{r.ticket.ticketNumber}</Link> },
          { key: "player", header: "Player", cell: (r) => <div className="min-w-0"><p className="truncate">{r.ticket.playerName}</p><p className="truncate text-xs text-muted-foreground">{r.customer.email}</p></div> },
          { key: "session", header: "Session", cell: (r) => <div className="min-w-0"><Link href={`/admin/sessions/${r.session.id}`} className="truncate hover:underline">{r.session.title}</Link><p className="text-xs text-muted-foreground">{formatDateTime(r.session.startsAt)}{r.slot ? ` · T${r.slot.teamNumber} P${r.slot.slotNumber}` : ""}</p></div> },
          { key: "price", header: "Paid", cell: (r) => formatMoney(r.ticket.price, r.ticket.currency) },
          { key: "status", header: "Status", cell: (r) => <TicketStatusBadge status={r.ticket.status} /> },
          { key: "purchased", header: "Purchased", hideOnMobile: true, cell: (r) => formatDateTime(r.ticket.purchasedAt) },
          { key: "actions", header: "", className: "w-12 text-right", mobileHeader: true, cell: (r) => <TicketRowActions ticket={{ id: r.ticket.id, ticketNumber: r.ticket.ticketNumber, status: r.ticket.status }} canManage={arena.permissions.includes("tickets.manage")} /> },
        ]}
      />
      <Suspense><Pagination page={result.meta.page} totalPages={result.meta.totalPages} total={result.meta.total} pageSize={result.meta.pageSize} /></Suspense>
    </div>
  )
}
