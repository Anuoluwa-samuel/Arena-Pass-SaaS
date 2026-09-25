import Link from "next/link"
import { Banknote, CalendarDays, CheckCircle2, Clock, Ticket, Users, XCircle, RotateCcw, ArrowRight, TriangleAlert } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/shared/page-header"
import { StatCard } from "@/components/admin/stat-card"
import { HorizontalBars, Meter, TimeSeriesChart } from "@/components/admin/charts"
import { StaggerGroup, StaggerItem } from "@/components/motion"
import { requireArenaPermission } from "@/server/auth/rbac"
import { getDashboardOverview, getRecentActivity } from "@/server/services/analytics"
import { getSettings } from "@/server/services/settings"
import { countPaymentsNeedingRefund } from "@/server/services/payments"
import { formatMoney, formatRelative, formatShortDate } from "@/lib/format"

export const metadata = { title: "Dashboard" }

const PAYMENT_ICON = { PAID: CheckCircle2, PENDING: Clock, FAILED: XCircle, REFUNDED: RotateCcw } as const
const PAYMENT_TONE = { PAID: "text-primary", PENDING: "text-warning", FAILED: "text-destructive", REFUNDED: "text-muted-foreground" } as const

export default async function AdminDashboard() {
  const { user, arena } = await requireArenaPermission("dashboard.view")
  const arenaId = arena.arenaId
  const [overview, activity, settings, needsRefund] = await Promise.all([getDashboardOverview(arenaId, { days: 30 }), getRecentActivity(arenaId), getSettings(arenaId), countPaymentsNeedingRefund(arenaId)])
  const canRefund = arena.permissions.includes("tickets.refund")
  const { kpis } = overview
  const currency = settings.currency
  const totalPayments = overview.payments.reduce((n, p) => n + p.count, 0)

  return (
    <div className="space-y-8 max-sm:space-y-5">
      <PageHeader title={`Good ${greeting()}, ${user.name.split(" ")[0]}`} description="Here's how the arena is doing over the last 30 days." actions={<Button asChild><Link href="/admin/sessions/new">Create session</Link></Button>} />

      {canRefund && needsRefund > 0 && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--warning-text)]" /><span><strong>{needsRefund} customer payment{needsRefund === 1 ? "" : "s"} need{needsRefund === 1 ? "s" : ""} a refund.</strong> They paid after their reservation expired and the session filled up, so no ticket was issued.</span></p>
          <Button size="sm" variant="outline" asChild><Link href="/admin/payments?status=NEEDS_REFUND">Review refunds</Link></Button>
        </div>
      )}

      <StaggerGroup trigger="mount" className="grid gap-4 max-sm:grid-cols-2 max-sm:gap-3 max-sm:[&>*:last-child]:col-span-2 sm:grid-cols-2 xl:grid-cols-5">
        <StaggerItem><StatCard label="Today's sales" value={formatMoney(kpis.todayRevenue, currency)} sub={`${kpis.todayTickets} ticket${kpis.todayTickets === 1 ? "" : "s"} today`} icon={Banknote} tone="primary" /></StaggerItem>
        <StaggerItem><StatCard label="Tickets sold (30d)" value={kpis.periodTickets} sub={`${kpis.ticketsByStatus.used} scanned in`} icon={Ticket} /></StaggerItem>
        <StaggerItem><StatCard label="Available slots" value={kpis.availableSlots} sub="across bookable sessions" icon={Users} /></StaggerItem>
        <StaggerItem><StatCard label="Upcoming sessions" value={kpis.upcomingSessions} sub="published or open" icon={CalendarDays} /></StaggerItem>
        <StaggerItem><StatCard label="Revenue (30d)" value={formatMoney(kpis.periodRevenue, currency)} sub={`${kpis.ticketsByStatus.refunded} refunded`} icon={Banknote} tone="primary" /></StaggerItem>
      </StaggerGroup>

      <div className="grid gap-6 max-sm:grid-cols-1 max-sm:gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Tickets sold per day</CardTitle></CardHeader>
          <CardContent><TimeSeriesChart data={overview.series} metric="tickets" currency={currency} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Revenue per day</CardTitle></CardHeader>
          <CardContent><TimeSeriesChart data={overview.series} metric="revenue" currency={currency} /></CardContent>
        </Card>
      </div>

      <div className="grid gap-6 max-sm:grid-cols-1 max-sm:gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Session occupancy</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link href="/admin/sessions">All sessions <ArrowRight className="ml-1 size-3.5" /></Link></Button>
          </CardHeader>
          <CardContent>
            {overview.occupancy.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No upcoming sessions. <Link href="/admin/sessions/new" className="text-primary hover:underline">Create one</Link>.</p>
            ) : (
              <HorizontalBars data={overview.occupancy.map((o) => ({ ...o, label: o.title, display: `${o.bookedCount}/${o.totalCapacity} · ${formatShortDate(o.startsAt)}` }))} labelKey="label" valueKey="bookedCount" max={Math.max(...overview.occupancy.map((o) => o.totalCapacity))} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Payments (30d)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {(["PAID", "PENDING", "FAILED", "REFUNDED"] as const).map((status) => {
              const row = overview.payments.find((p) => p.status === status)
              const Icon = PAYMENT_ICON[status]
              const count = row?.count ?? 0
              return (
                <div key={status}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2"><Icon className={`size-4 ${PAYMENT_TONE[status]}`} />{status.charAt(0) + status.slice(1).toLowerCase()}</span>
                    <span className="tabular-nums text-muted-foreground">{count} · {formatMoney(row?.amount ?? 0, currency)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-foreground/60" style={{ width: `${totalPayments ? (count / totalPayments) * 100 : 0}%` }} /></div>
                </div>
              )
            })}
            <div className="border-t border-border pt-4">
              <Meter value={overview.attendance.admitted} max={overview.attendance.eligible} label="Attendance (finished sessions)" sub={`${overview.attendance.admitted} of ${overview.attendance.eligible} ticket holders scanned in`} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 max-sm:grid-cols-1 max-sm:gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-base">Most popular sessions</CardTitle></CardHeader>
          <CardContent>
            {overview.popular.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No sales yet.</p> : <HorizontalBars data={overview.popular.map((p) => ({ ...p, label: p.title, display: `${p.sold} sold` }))} labelKey="label" valueKey="sold" />}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Recent activity</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link href="/admin/audit-logs">Audit log <ArrowRight className="ml-1 size-3.5" /></Link></Button>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {activity.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate">{a.description}</p>
                      <p className="text-xs text-muted-foreground">{a.actorName ?? "System"} · {a.action}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"
}
