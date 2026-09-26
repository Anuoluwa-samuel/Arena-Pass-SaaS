"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SubscriptionStatusBadge } from "@/components/admin/subscription-status-badge"
import { EmptyState } from "@/components/shared/empty-state"
import { api, errorMessage } from "@/lib/api-client"
import { formatMoney, formatShortDate } from "@/lib/format"
import type { SubscriptionStatus } from "@/lib/domain/constants"

export interface SubscriptionRow {
  organizationId: string
  organizationName: string
  organizationSlug: string
  billingEmail: string | null
  status: SubscriptionStatus
  planKey: string
  planName: string
  priceMinor: number
  currency: string
  currentPeriodEnd: string
  trialEndsAt: string | null
}

/**
 * Every organization's standing, with the plan changeable in place.
 *
 * Changing a plan here is a platform operation on somebody else's
 * organization, so it is recorded twice — a subscription event and an audit
 * entry — rather than being a quiet dropdown.
 */
export function PlatformSubscriptionsTable({
  subscriptions,
  plans,
  canManage,
}: {
  subscriptions: SubscriptionRow[]
  plans: { key: string; name: string; isPublic: boolean }[]
  canManage: boolean
}) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)

  if (subscriptions.length === 0) {
    return <EmptyState title="No organizations yet" description="Subscriptions appear here as venues register." />
  }

  const change = async (row: SubscriptionRow, planKey: string) => {
    if (planKey === row.planKey) return
    setBusyId(row.organizationId)
    try {
      await api.patch("/api/platform/subscriptions", { organizationId: row.organizationId, planKey })
      toast.success(`${row.organizationName} moved to ${plans.find((p) => p.key === planKey)?.name ?? planKey}`)
      router.refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y">
          {subscriptions.map((row) => (
            <li key={row.organizationId} className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{row.organizationName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.organizationSlug}
                  {row.billingEmail ? ` · ${row.billingEmail}` : ""}
                </p>
              </div>

              <SubscriptionStatusBadge status={row.status} />

              <div className="text-right text-sm tabular-nums">
                <p className="font-medium">
                  {row.priceMinor === 0 ? "Free" : formatMoney(row.priceMinor, row.currency)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {row.trialEndsAt ? `trial to ${formatShortDate(row.trialEndsAt)}` : `to ${formatShortDate(row.currentPeriodEnd)}`}
                </p>
              </div>

              {canManage ? (
                <Select
                  value={row.planKey}
                  onValueChange={(v) => change(row, v)}
                  disabled={busyId === row.organizationId}
                >
                  <SelectTrigger className="w-40" aria-label={`Plan for ${row.organizationName}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {plans.map((p) => (
                      <SelectItem key={p.key} value={p.key}>
                        {p.name}
                        {!p.isPublic && " (internal)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="w-40 text-sm text-muted-foreground">{row.planName}</span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
