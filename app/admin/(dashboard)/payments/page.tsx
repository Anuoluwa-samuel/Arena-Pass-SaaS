import Link from "next/link"
import { Suspense } from "react"
import { CreditCard, TriangleAlert } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"
import { PaymentStatusBadge, TicketStatusBadge } from "@/components/shared/status-badge"
import { DataTable } from "@/components/admin/data-table"
import { FilterTabs, Pagination, SearchBox } from "@/components/admin/list-toolbar"
import { RefundButton } from "@/components/admin/refund-button"
import { requireArenaPermission } from "@/server/auth/rbac"
import { countPaymentsNeedingRefund, listPayments } from "@/server/services/payments"
import { ToneBadge } from "@/components/shared/status-badge"
import { formatDateTime, formatMoney } from "@/lib/format"

export const metadata = { title: "Payments" }

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { arena } = await requireArenaPermission("payments.view")
  const sp = await searchParams
  const [result, needsRefund] = await Promise.all([listPayments(arena.arenaId, { status: sp.status, q: sp.q, page: Number(sp.page ?? 1), pageSize: 25 }), countPaymentsNeedingRefund(arena.arenaId)])
  const canRefund = arena.permissions.includes("tickets.refund")
  return (
    <div className="space-y-6">
      <PageHeader title="Payments" description="Every payment attempt, verified server-side with the provider." />
      {needsRefund > 0 && sp.status !== "NEEDS_REFUND" && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--warning-text)]" /><span><strong>{needsRefund} payment{needsRefund === 1 ? "" : "s"} need{needsRefund === 1 ? "s" : ""} a refund.</strong> These customers were charged but got no ticket because the session filled up.</span></p>
          <Link href="/admin/payments?status=NEEDS_REFUND" className="shrink-0 text-sm font-medium text-[var(--warning-text)] hover:underline">Review</Link>
        </div>
      )}
      <Suspense>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <FilterTabs options={[{ value: "all", label: "All" }, { value: "NEEDS_REFUND", label: needsRefund ? `Needs refund (${needsRefund})` : "Needs refund" }, { value: "PAID", label: "Paid" }, { value: "PENDING", label: "Pending" }, { value: "FAILED", label: "Failed" }, { value: "REFUNDED", label: "Refunded" }]} />
          <SearchBox placeholder="Reference, name or email" className="md:w-80" />
        </div>
      </Suspense>
      <DataTable
        rows={result.items}
        rowKey={(r) => r.payment.id}
        mobileTitle={(r) => <span className="font-mono">{r.payment.reference}</span>}
        empty={<EmptyState icon={CreditCard} title="No payments found" />}
        columns={[
          { key: "ref", header: "Reference", hideOnMobile: true, cell: (r) => <div><p className="font-mono text-sm">{r.payment.reference}</p><p className="text-xs text-muted-foreground">{r.payment.provider}{r.payment.channel ? ` · ${r.payment.channel}` : ""}</p></div> },
          { key: "customer", header: "Customer", cell: (r) => <div className="min-w-0"><p className="truncate">{r.customer.name}</p><p className="truncate text-xs text-muted-foreground">{r.customer.email}</p></div> },
          { key: "session", header: "Session", cell: (r) => <Link href={`/admin/sessions/${r.session.id}`} className="hover:underline">{r.session.title}</Link> },
          { key: "amount", header: "Amount", cell: (r) => <span className="tabular-nums">{formatMoney(r.payment.amount, r.payment.currency)}</span> },
          { key: "status", header: "Status", cell: (r) => <div className="flex flex-wrap gap-1"><PaymentStatusBadge status={r.payment.status} />{r.payment.refundRequiredAt && r.payment.status === "PAID" && <ToneBadge tone="warning">Needs refund</ToneBadge>}{r.ticket?.status && r.ticket.status !== "CONFIRMED" && <TicketStatusBadge status={r.ticket.status} />}</div> },
          { key: "when", header: "Date", hideOnMobile: true, cell: (r) => formatDateTime(r.payment.createdAt) },
          { key: "actions", header: "", className: "text-right", cell: (r) => (canRefund && r.payment.status === "PAID" ? <RefundButton paymentId={r.payment.id} reference={r.payment.reference} amount={formatMoney(r.payment.amount, r.payment.currency)} /> : r.payment.failureReason ? <span className="text-xs text-muted-foreground">{r.payment.failureReason}</span> : null) },
        ]}
      />
      <Suspense><Pagination page={result.meta.page} totalPages={result.meta.totalPages} total={result.meta.total} pageSize={result.meta.pageSize} /></Suspense>
    </div>
  )
}
