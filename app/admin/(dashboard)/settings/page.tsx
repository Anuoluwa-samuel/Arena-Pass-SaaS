import { PageHeader } from "@/components/shared/page-header"
import { SettingsForm } from "@/components/admin/settings-form"
import { BrandingForm } from "@/components/admin/branding-form"
import { PaymentAccountForm } from "@/components/admin/payment-account-form"
import { requireArenaPermission } from "@/server/auth/rbac"
import { getSettings } from "@/server/services/settings"
import { getBranding } from "@/server/services/branding"
import { listPaymentAccounts } from "@/server/payments/accounts"
import { env } from "@/server/env"

export const metadata = { title: "System settings" }

export default async function SettingsPage() {
  const { arena } = await requireArenaPermission("settings.view")
  const [settings, branding, accounts] = await Promise.all([
    getSettings(arena.arenaId),
    getBranding(arena.arenaId),
    listPaymentAccounts(arena.arenaId),
  ])
  const account = accounts.find((a) => a.provider === env.PAYMENT_PROVIDER) ?? null
  const canManage = arena.permissions.includes("settings.manage")
  return (
    <div className="space-y-6">
      <PageHeader title="System settings" description="Defaults for new sessions, booking behaviour and site identity. Changes apply immediately." />
      <PaymentAccountForm
        provider={env.PAYMENT_PROVIDER}
        canManage={canManage}
        account={
          account
            ? {
                id: account.id,
                provider: account.provider,
                status: account.status,
                publicKey: account.publicKey,
                secretKeySet: account.secretKeySet,
                webhookSecretSet: account.webhookSecretSet,
              }
            : null
        }
      />
      <BrandingForm initial={{ primaryColor: branding.primaryColor, accentColor: branding.accentColor }} canManage={canManage} />
      <SettingsForm initial={settings} canManage={canManage} />
    </div>
  )
}
