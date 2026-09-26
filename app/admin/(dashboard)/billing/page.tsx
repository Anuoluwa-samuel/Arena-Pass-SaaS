import { PageHeader } from "@/components/shared/page-header"
import { BillingPanel } from "@/components/admin/billing-panel"
import { requireArenaPermission } from "@/server/auth/rbac"
import { getBillingSummaryForArena } from "@/server/services/billing"

export const dynamic = "force-dynamic"
export const metadata = { title: "Billing" }

export default async function BillingPage() {
  const { arena } = await requireArenaPermission("billing.view")
  const summary = await getBillingSummaryForArena(arena.arenaId)
  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description="Your organization's Game Slots subscription — separate from the money your customers pay you, which is under Payments."
      />
      <BillingPanel summary={summary} />
    </div>
  )
}
