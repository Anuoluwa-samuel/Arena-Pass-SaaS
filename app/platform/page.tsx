import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/shared/page-header"
import { requirePlatformPermission } from "@/server/auth/rbac"
import { getPlatformOverview } from "@/server/services/platform"

export const metadata = { title: "Overview" }

export default async function PlatformOverviewPage() {
  await requirePlatformPermission("platform.overview.view")
  const stats = await getPlatformOverview()

  const tiles: Array<[string, number, string?]> = [
    ["Organizations", stats.organizations],
    ["Arenas", stats.arenas, `${stats.live_arenas} live · ${stats.setting_up} setting up · ${stats.suspended} suspended`],
    ["Operators", stats.operators],
    ["Customers", stats.customers, "across every arena"],
    ["Sessions", stats.sessions],
    ["Tickets", stats.tickets],
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform overview"
        description="Every organization and arena on Arena Pass. These totals span tenants — no arena can see them."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map(([label, value, sub]) => (
          <Card key={label} variant="glass">
            <CardContent className="p-5">
              <p className="label-mono text-muted-foreground">{label}</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
              {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
