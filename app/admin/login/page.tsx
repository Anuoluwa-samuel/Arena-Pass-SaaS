import { Suspense } from "react"
import { redirect } from "next/navigation"
import { AdminLoginForm } from "@/components/admin/admin-login-form"
import { getCurrentUser } from "@/server/auth/session"
import { getSettings } from "@/server/services/settings"
import { requireTenantContextForPage } from "@/server/tenant"

export const dynamic = "force-dynamic"
export const metadata = { title: "Admin sign in" }

export default async function AdminLoginPage() {
  if (await getCurrentUser()) redirect("/admin")
  const settings = await getSettings((await requireTenantContextForPage()).arenaId)
  return (
    <Suspense>
      <AdminLoginForm siteName={settings.siteName} />
    </Suspense>
  )
}
