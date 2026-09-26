import { AlertTriangle, Infinity as InfinityIcon } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { SubscriptionStatusBadge } from "@/components/admin/subscription-status-badge"
import { formatMoney, formatShortDate } from "@/lib/format"
import type { BillingSummary } from "@/server/services/billing"

/**
 * What this organization's Game Slots subscription covers, and how much of it
 * is being used. Read-only: nothing here charges anyone, because nothing in
 * this phase can.
 */
export function BillingPanel({ summary }: { summary: BillingSummary }) {
  const { plan, subscription, usage } = summary
  const trialLeft = subscription.trialDaysLeft

  return (
    <div className="space-y-6">
      {!summary.canWriteAsAdmin && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <div className="text-sm">
            <p className="font-semibold">Changes are paused</p>
            <p className="mt-1 text-muted-foreground">
              Your subscription lapsed, so new sessions and staff are on hold. Your booking site, your existing
              tickets and gate validation all keep working — customers who have paid are unaffected.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div className="min-w-0">
            <CardTitle className="text-base">{plan.name}</CardTitle>
            <CardDescription>{plan.description}</CardDescription>
          </div>
          <SubscriptionStatusBadge status={subscription.status} />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-3xl font-semibold">
              {plan.priceMinor === 0 ? "Free" : formatMoney(plan.priceMinor, plan.currency)}
            </span>
            {plan.priceMinor > 0 && (
              <span className="text-sm text-muted-foreground">
                per {plan.interval === "YEARLY" ? "year" : "month"}
              </span>
            )}
          </div>

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {trialLeft !== null && (
              <Row label="Trial ends">
                {formatShortDate(subscription.trialEndsAt!)} · {trialLeft} day{trialLeft === 1 ? "" : "s"} left
              </Row>
            )}
            <Row label={subscription.status === "TRIALING" ? "Then renews" : "Renews"}>
              {formatShortDate(subscription.currentPeriodEnd)}
            </Row>
            {subscription.cancelledAt && (
              <Row label="Cancelled">{formatShortDate(subscription.cancelledAt)}</Row>
            )}
          </dl>

          <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            Nothing is charged yet. Payment for Game Slots subscriptions is not switched on — this shows what
            your plan covers and what you are using.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage</CardTitle>
          <CardDescription>Counted across every arena in your organization.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {usage.map((row) => {
            const unlimited = row.limit === null
            const pct = unlimited ? 0 : Math.min(100, Math.round((row.used / Math.max(1, row.limit!)) * 100))
            const atLimit = !unlimited && row.used >= row.limit!
            return (
              <div key={row.metric}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{row.label}</span>
                  <span className={atLimit ? "font-medium text-destructive" : "text-muted-foreground"}>
                    {row.used}
                    {unlimited ? (
                      <span className="ml-1 inline-flex items-center gap-1">
                        / <InfinityIcon className="size-3.5" aria-label="unlimited" />
                      </span>
                    ) : (
                      ` / ${row.limit}`
                    )}
                  </span>
                </div>
                {!unlimited && <Progress value={pct} className="mt-2 h-1.5" />}
                {atLimit && (
                  <p className="mt-1.5 text-xs text-destructive">
                    At the plan limit. Upgrade to add more.
                  </p>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 sm:block">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium sm:mt-0.5">{children}</dd>
    </div>
  )
}
