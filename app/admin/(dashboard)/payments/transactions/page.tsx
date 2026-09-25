import { Suspense } from "react"
import { Receipt } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"
import { ToneBadge } from "@/components/shared/status-badge"
import { DataTable } from "@/components/admin/data-table"
import { Pagination } from "@/components/admin/list-toolbar"
import { requireArenaPermission } from "@/server/auth/rbac"
import { listTransactions } from "@/server/services/payments"
import { formatDateTime, formatMoney } from "@/lib/format"

export const metadata = { title: "Transactions" }

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { arena } = await requireArenaPermission("payments.view")
  const sp = await searchParams
  const result = await listTransactions(arena.arenaId, { page: Number(sp.page ?? 1), pageSize: 50 })
  return (
    <div className="space-y-6">
      <PageHeader title="Transactions" description="Immutable ledger of charges and refunds." />
      <DataTable
        rows={result.items}
        rowKey={(r) => r.transaction.id}
        mobileTitle={(r) => `${r.transaction.type} · ${formatMoney(r.transaction.amount, r.transaction.currency)}`}
        empty={<EmptyState icon={Receipt} title="No transactions yet" />}
        columns={[
          { key: "when", header: "Date", cell: (r) => formatDateTime(r.transaction.createdAt) },
          { key: "type", header: "Type", cell: (r) => <ToneBadge tone={r.transaction.type === "CHARGE" ? "success" : "warning"}>{r.transaction.type}</ToneBadge> },
          { key: "amount", header: "Amount", cell: (r) => <span className={"tabular-nums " + (r.transaction.amount < 0 ? "text-destructive" : "")}>{formatMoney(r.transaction.amount, r.transaction.currency)}</span> },
          { key: "ref", header: "Payment", hideOnMobile: true, cell: (r) => <span className="font-mono text-xs">{r.payment.reference}</span> },
          { key: "ticket", header: "Ticket", cell: (r) => <span className="font-mono text-xs">{r.ticket?.ticketNumber ?? "—"}</span> },
          { key: "provider", header: "Provider ref", hideOnMobile: true, cell: (r) => <span className="text-xs text-muted-foreground">{r.transaction.provider}{r.transaction.providerReference ? ` · ${r.transaction.providerReference}` : ""}</span> },
          { key: "reason", header: "Note", hideOnMobile: true, cell: (r) => <span className="text-xs text-muted-foreground">{r.transaction.reason ?? ""}</span> },
        ]}
      />
      <Suspense><Pagination page={result.meta.page} totalPages={result.meta.totalPages} total={result.meta.total} pageSize={result.meta.pageSize} /></Suspense>
    </div>
  )
}
