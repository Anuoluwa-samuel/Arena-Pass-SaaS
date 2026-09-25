import { redirect } from "next/navigation"
import { ForgotPasswordForm } from "@/components/site/forgot-password-form"
import { getCurrentCustomer } from "@/server/auth/session"
import { getSettings } from "@/server/services/settings"
import { requirePublicTenantForPage } from "@/server/tenant"

export const metadata = { title: "Forgot password" }

export default async function ForgotPasswordPage() {
  // Signed-in customers change their password from their profile instead.
  if (await getCurrentCustomer()) redirect("/account/profile#password")
  const settings = await getSettings((await requirePublicTenantForPage()).arenaId)
  return <ForgotPasswordForm siteName={settings.siteName} />
}
