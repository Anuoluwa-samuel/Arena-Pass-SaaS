import { Suspense } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/shared/page-header"
import { StatCard } from "@/components/admin/stat-card"
import { FilterTabs } from "@/components/admin/list-toolbar"
import { HorizontalBars, Meter, TimeSeriesChart } from "@/components/admin/charts"
import { requireArenaPermission } from "@/server/auth/rbac"
import { getDashboardOverview } from "@/server/services/analytics"
import { getSettings } from "@/server/services/settings"
import { formatMoney, formatShortDate } from "@/lib/format"

export const metadata = { title: "Analytics" }

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { arena } = await requireArenaPermission("analytics.view")
  const { days: d } = await searchParams
  const days = [7, 30, 90, 180].includes(Number(d)) ? Number(d) : 30
  const arenaId = arena.arenaId
  const [o, settings] = await Promise.all([getDashboardOverview(arenaId, { days }), getSettings(arenaId)])
  const currency = settings.currency
  const avg = o.kpis.periodTickets ? Math.round(o.kpis.periodRevenue / o.kpis.periodTickets) : 0
  const totalStatus = Object.values(o.kpis.ticketsByStatus).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description="Sales, revenue, occupancy and attendance over time." actions={<Suspense><FilterTabs param="days" options={[{ value: "30", label: "30 days" }, { value: "7", label: "7 days" }, { value: "90", label: "90 days" }, { value: "180", label: "6 months" }]} /></Suspense>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={`Revenue (${days}d)`} value={formatMoney(o.kpis.periodRevenue, currency)} tone="primary" />
        <StatCard label={`Tickets (${days}d)`} value={o.kpis.periodTickets} />
        <StatCard label="Average ticket" value={formatMoney(avg, currency)} />
        <StatCard label="Attendance rate" value={o.attendance.eligible ? `${Math.round((o.attendance.admitted / o.attendance.eligible) * 100)}%` : "—"} sub={`${o.attendance.admitted}/${o.attendance.eligible} scanned in`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">Tickets sold per day</CardTitle></CardHeader><CardContent><TimeSeriesChart data={o.series} metric="tickets" currency={currency} height={260} /></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Revenue per day</CardTitle></CardHeader><CardContent><TimeSeriesChart data={o.series} metric="revenue" currency={currency} height={260} /></CardContent></Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Occupancy of upcoming sessions</CardTitle></CardHeader>
          <CardContent>{o.occupancy.length ? <HorizontalBars data={o.occupancy.map((s) => ({ ...s, label: s.title, display: `${s.percent}% · ${formatShortDate(s.startsAt)}` }))} labelKey="label" valueKey="percent" max={100} /> : <p className="py-8 text-center text-sm text-muted-foreground">No upcoming sessions.</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Top sessions by revenue</CardTitle></CardHeader>
          <CardContent>{o.popular.length ? <HorizontalBars data={o.popular.map((p) => ({ ...p, label: p.title, display: formatMoney(p.revenue, currency) }))} labelKey="label" valueKey="revenue" /> : <p className="py-8 text-center text-sm text-muted-foreground">No sales in this period.</p>}</CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Ticket status (all time)</CardTitle></CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {(["confirmed", "used", "refunded", "cancelled"] as const).map((k) => (
            <Meter key={k} value={o.kpis.ticketsByStatus[k]} max={totalStatus} label={k.charAt(0).toUpperCase() + k.slice(1)} sub={`${o.kpis.ticketsByStatus[k]} tickets`} />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
