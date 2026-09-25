import Link from "next/link"
import { Suspense } from "react"
import { Users } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"
import { DataTable } from "@/components/admin/data-table"
import { Pagination, SearchBox } from "@/components/admin/list-toolbar"
import { ToneBadge } from "@/components/shared/status-badge"
import { requireArenaPermission } from "@/server/auth/rbac"
import { listCustomers } from "@/server/services/customers"
import { getSettings } from "@/server/services/settings"
import { formatMoney, formatShortDate } from "@/lib/format"

export const metadata = { title: "Customers" }

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { arena } = await requireArenaPermission("customers.view")
  const sp = await searchParams
  const [result, settings] = await Promise.all([listCustomers(arena.arenaId, { q: sp.q, page: Number(sp.page ?? 1), pageSize: 25 }), getSettings(arena.arenaId)])
  return (
    <div className="space-y-6">
      <PageHeader title="Customers" description="Everyone who has booked or created an account." />
      <Suspense><SearchBox placeholder="Name, email or phone" className="md:w-80" /></Suspense>
      <DataTable
        rows={result.items}
        rowKey={(r) => r.customer.id}
        mobileTitle={(r) => <Link href={`/admin/customers/${r.customer.id}`} className="hover:underline">{r.customer.name}</Link>}
        empty={<EmptyState icon={Users} title="No customers found" />}
        columns={[
          { key: "name", header: "Customer", hideOnMobile: true, cell: (r) => <div><Link href={`/admin/customers/${r.customer.id}`} className="font-medium hover:underline">{r.customer.name}</Link><p className="text-xs text-muted-foreground">{r.customer.email}{r.customer.phone ? ` · ${r.customer.phone}` : ""}</p></div> },
          { key: "account", header: "Account", cell: (r) => (r.customer.passwordHash ? <ToneBadge tone="success">Registered</ToneBadge> : <ToneBadge tone="muted">Guest</ToneBadge>) },
          { key: "tickets", header: "Tickets", cell: (r) => r.ticketCount },
          { key: "spent", header: "Spent", cell: (r) => formatMoney(r.totalSpent, settings.currency) },
          { key: "since", header: "Since", cell: (r) => formatShortDate(r.customer.createdAt) },
          { key: "active", header: "Status", cell: (r) => (r.customer.isActive ? <ToneBadge tone="neutral">Active</ToneBadge> : <ToneBadge tone="danger">Disabled</ToneBadge>) },
        ]}
      />
      <Suspense><Pagination page={result.meta.page} totalPages={result.meta.totalPages} total={result.meta.total} pageSize={result.meta.pageSize} /></Suspense>
    </div>
  )
}
