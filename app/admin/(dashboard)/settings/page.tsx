import { PageHeader } from "@/components/shared/page-header"
import { SettingsForm } from "@/components/admin/settings-form"
import { requireArenaPermission } from "@/server/auth/rbac"
import { getSettings } from "@/server/services/settings"

export const metadata = { title: "System settings" }

export default async function SettingsPage() {
  const { arena } = await requireArenaPermission("settings.view")
  const settings = await getSettings(arena.arenaId)
  return (
    <div className="space-y-6">
      <PageHeader title="System settings" description="Defaults for new sessions, booking behaviour and site identity. Changes apply immediately." />
      <SettingsForm initial={settings} canManage={arena.permissions.includes("settings.manage")} />
    </div>
  )
}
