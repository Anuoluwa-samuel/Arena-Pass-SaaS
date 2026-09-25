import { redirect } from "next/navigation"
import { PageHeader } from "@/components/shared/page-header"
import { RegisterArenaForm } from "@/components/site/register-arena-form"
import { getCurrentUser } from "@/server/auth/session"
import { rootDomain } from "@/server/tenant/resolver"

export const dynamic = "force-dynamic"
export const metadata = { title: "Open your arena" }

/**
 * Where a new operator signs up. This page belongs to the platform rather than
 * to any arena, which is why it does not resolve a tenant.
 */
export default async function StartPage() {
  const user = await getCurrentUser()
  if (user && user.memberships.length > 0) redirect("/admin/onboarding")

  return (
    <main className="mx-auto max-w-lg px-4 py-14 sm:py-20">
      <PageHeader
        eyebrow="Arena Pass"
        title="Open your arena"
        description="Take bookings, issue tickets and run the gate. Set up takes a few minutes and nothing is charged until you launch."
      />
      <div className="mt-8">
        <RegisterArenaForm rootDomain={rootDomain()} signedInAs={user?.email ?? null} />
      </div>
    </main>
  )
}
