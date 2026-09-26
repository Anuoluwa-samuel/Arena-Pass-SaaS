import { PageHeader } from "@/components/shared/page-header"
import { PlatformSubscriptionsTable } from "@/components/admin/platform-subscriptions-table"
import { requirePlatformPermission } from "@/server/auth/rbac"
import { listPlans, listSubscriptions } from "@/server/services/billing"

export const dynamic = "force-dynamic"
export const metadata = { title: "Subscriptions" }

export default async function PlatformSubscriptionsPage() {
  const { platform } = await requirePlatformPermission("platform.subscriptions.view")
  const [subscriptions, plans] = await Promise.all([listSubscriptions(), listPlans({ includePrivate: true })])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subscriptions"
        description="What every organization is on. Nothing is charged yet — moving an organization between plans changes what its limits allow, not what it pays."
      />
      <PlatformSubscriptionsTable
        subscriptions={subscriptions.map((s) => ({
          organizationId: s.organizationId,
          organizationName: s.organizationName,
          organizationSlug: s.organizationSlug,
          billingEmail: s.billingEmail,
          status: s.status,
          planKey: s.planKey,
          planName: s.planName,
          priceMinor: s.priceMinor,
          currency: s.currency,
          currentPeriodEnd: s.currentPeriodEnd.toISOString(),
          trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
        }))}
        plans={plans.map((p) => ({ key: p.key, name: p.name, isPublic: p.isPublic }))}
        canManage={platform.permissions.includes("platform.subscriptions.manage")}
      />
    </div>
  )
}
