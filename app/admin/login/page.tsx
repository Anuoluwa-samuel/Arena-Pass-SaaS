import { Suspense } from "react"
import { notFound, redirect } from "next/navigation"
import { AdminLoginForm } from "@/components/admin/admin-login-form"
import { getCurrentUser } from "@/server/auth/session"
import { getSettings } from "@/server/services/settings"
import { getTenantContext } from "@/server/tenant"
import { env } from "@/server/env"

export const dynamic = "force-dynamic"
export const metadata = { title: "Admin sign in" }

/**
 * Sign-in for staff, on two kinds of address.
 *
 * On an arena's own hostname it wears that arena's name, which is what someone
 * arriving from their venue's site expects to see.
 *
 * On the platform's hostname there is no arena to name — and there cannot be,
 * because this is where an operator arrives from the Game Slots front door
 * ("I already have one") precisely when they have not gone to their arena's
 * address. It previously required a tenant and so answered that button with a
 * 404. It now falls back to the platform's own name, and `/admin` sorts out
 * which arena they land in once they are signed in.
 */
export default async function AdminLoginPage() {
  if (await getCurrentUser()) redirect("/admin")
  const tenant = await getTenantContext()
  // An archived arena's address stays a dead end, as it was before: falling
  // back to the platform's name here would turn it into a working sign-in page
  // for an arena that no longer exists.
  if (tenant?.arena.status === "ARCHIVED") notFound()
  const siteName = tenant ? (await getSettings(tenant.arenaId)).siteName : env.APP_NAME
  return (
    <Suspense>
      <AdminLoginForm siteName={siteName} />
    </Suspense>
  )
}
