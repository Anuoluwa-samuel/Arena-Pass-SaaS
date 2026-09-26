import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { CheckoutForm } from "@/components/site/checkout-form"
import { getSessionWithTeams } from "@/server/services/sessions"
import { getCurrentCustomer } from "@/server/auth/session"
import { toPublicSession, toPublicTeams } from "@/server/serializers"
import { AppError } from "@/server/http/errors"
import { requirePublicTenantForPage } from "@/server/tenant"

export const dynamic = "force-dynamic"
export const metadata = { title: "Checkout" }

export default async function CheckoutPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  let data: Awaited<ReturnType<typeof getSessionWithTeams>>
  try {
    data = await getSessionWithTeams((await requirePublicTenantForPage()).arenaId, sessionId)
  } catch (err) {
    if (err instanceof AppError && err.code === "SESSION_NOT_FOUND") notFound()
    throw err
  }
  const session = toPublicSession(data.session)
  if (session.status !== "OPEN_FOR_BOOKING") redirect(`/sessions/${sessionId}`)
  // Booking requires an account. Sending an unauthenticated visitor to sign in
  // — with the way back — is kinder than letting them fill a form the API will
  // refuse, and it is the same rule the route enforces rather than a second one.
  const customer = await getCurrentCustomer()
  if (!customer) redirect(`/login?next=${encodeURIComponent(`/checkout/${sessionId}`)}`)

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href={`/sessions/${sessionId}`} className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Back to session
      </Link>
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Step 1 of 2</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Reserve your slot</h1>
        <p className="mt-2 text-muted-foreground">Confirm who&apos;s playing, then pay securely to hold your slot.</p>
      </div>
      <CheckoutForm session={session} teams={toPublicTeams(data.teams)} customer={{ name: customer.name, email: customer.email, phone: customer.phone ?? "" }} />
    </main>
  )
}
