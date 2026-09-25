import { Suspense } from "react"
import { Bell } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"
import { ToneBadge } from "@/components/shared/status-badge"
import { DataTable } from "@/components/admin/data-table"
import { FilterTabs, Pagination } from "@/components/admin/list-toolbar"
import { RetryNotificationButton } from "@/components/admin/retry-notification-button"
import { requireArenaPermission } from "@/server/auth/rbac"
import { listNotifications } from "@/server/services/notifications"
import { formatDateTime } from "@/lib/format"

export const metadata = { title: "Notifications" }
const TONE = { SENT: "success", PENDING: "warning", FAILED: "danger", READ: "neutral" } as const

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { arena } = await requireArenaPermission("notifications.view")
  const sp = await searchParams
  const result = await listNotifications(arena.arenaId, { status: sp.status, channel: sp.channel, page: Number(sp.page ?? 1), pageSize: 30 })
  return (
    <div className="space-y-6">
      <PageHeader title="Notifications" description="Emails and in-app alerts sent by the platform. Failed deliveries can be retried." />
      <Suspense>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
          <FilterTabs options={[{ value: "all", label: "All" }, { value: "SENT", label: "Sent" }, { value: "PENDING", label: "Pending" }, { value: "FAILED", label: "Failed" }]} />
          <FilterTabs param="channel" options={[{ value: "all", label: "All channels" }, { value: "EMAIL", label: "Email" }, { value: "IN_APP", label: "In-app" }, { value: "SMS", label: "SMS" }]} />
        </div>
      </Suspense>
      <DataTable
        rows={result.items}
        rowKey={(n) => n.id}
        mobileTitle={(n) => n.title}
        empty={<EmptyState icon={Bell} title="No notifications yet" />}
        columns={[
          { key: "when", header: "Time", cell: (n) => <span className="whitespace-nowrap">{formatDateTime(n.createdAt)}</span> },
          { key: "channel", header: "Channel", cell: (n) => <ToneBadge tone="neutral">{n.channel.replace("_", "-")}</ToneBadge> },
          { key: "title", header: "Message", hideOnMobile: true, cell: (n) => <div className="min-w-0 max-w-md"><p className="truncate">{n.title}</p><p className="truncate text-xs text-muted-foreground">{n.type}{n.recipientAddress ? ` → ${n.recipientAddress}` : ""}</p></div> },
          { key: "status", header: "Status", cell: (n) => <div><ToneBadge tone={TONE[n.status]}>{n.status}</ToneBadge>{n.error && <p className="mt-1 max-w-xs truncate text-xs text-destructive" title={n.error}>{n.error}</p>}</div> },
          { key: "actions", header: "", className: "text-right", cell: (n) => (n.status === "FAILED" && arena.permissions.includes("notifications.manage") ? <RetryNotificationButton id={n.id} /> : null) },
        ]}
      />
      <Suspense><Pagination page={result.meta.page} totalPages={result.meta.totalPages} total={result.meta.total} pageSize={result.meta.pageSize} /></Suspense>
    </div>
  )
}
