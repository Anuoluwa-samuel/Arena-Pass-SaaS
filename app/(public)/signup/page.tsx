import { Suspense } from "react"
import { redirect } from "next/navigation"
import { AuthForm } from "@/components/site/auth-form"
import { getSettings } from "@/server/services/settings"
import { env } from "@/server/env"
import { getCurrentCustomer } from "@/server/auth/session"
import { safeNextPath } from "@/lib/safe-next"
import { requirePublicTenantForPage } from "@/server/tenant"

export const metadata = { title: "Create account" }

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // Already signed in (e.g. Back after signing up, or an old link): don't show the form again.
  if (await getCurrentCustomer()) redirect(safeNextPath((await searchParams).next, "/account"))
  const settings = await getSettings((await requirePublicTenantForPage()).arenaId)
  return (
    <Suspense>
      <AuthForm mode="signup" siteName={settings.siteName} googleEnabled={env.googleEnabled} />
    </Suspense>
  )
}
