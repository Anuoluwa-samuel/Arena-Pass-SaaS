import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowRight, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DigitalTicket } from "@/components/site/digital-ticket"
import { StaggerGroup, StaggerItem } from "@/components/motion"
import { getTicketByNumber, qrDataUrl } from "@/server/services/tickets"
import { getCurrentCustomer, getCurrentUser } from "@/server/auth/session"
import { canInArena } from "@/server/tenant/authorization"
import { ticketAccessKey, toPublicTicket } from "@/server/serializers"
import { safeEqual } from "@/server/auth/tokens"
import { AppError } from "@/server/http/errors"
import { scaleInItem, fadeUpItem } from "@/lib/motion"

export const dynamic = "force-dynamic"
export const metadata = { title: "Your ticket" }

export default async function TicketPage({ params, searchParams }: { params: Promise<{ ticketNumber: string }>; searchParams: Promise<{ k?: string; new?: string }> }) {
  const { ticketNumber } = await params
  const { k = "", new: isNew } = await searchParams
  let detail: Awaited<ReturnType<typeof getTicketByNumber>>
  try {
    detail = await getTicketByNumber(ticketNumber.toUpperCase())
  } catch (err) {
    if (err instanceof AppError && err.code === "TICKET_NOT_FOUND") notFound()
    throw err
  }
  const [customer, user] = await Promise.all([getCurrentCustomer(), getCurrentUser()])
  const allowed = (customer && customer.id === detail.ticket.customerId) || (user && canInArena(user, detail.ticket.arenaId, "tickets.view")) || (k && safeEqual(k, ticketAccessKey(detail.ticket.ticketNumber)))

  if (!allowed) {
    return (
      <main className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-secondary"><Lock className="size-7 text-muted-foreground" /></div>
        <h1 className="mt-6 text-2xl font-bold">This ticket is private</h1>
        <p className="mt-2 text-muted-foreground">Open the link from your confirmation email, or sign in to the account that bought it.</p>
        <Button asChild className="mt-6"><Link href={`/login?next=/tickets/${ticketNumber}`}>Sign in</Link></Button>
      </main>
    )
  }

  const ticket = toPublicTicket(detail)
  const qr = await qrDataUrl(detail.ticket)

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <StaggerGroup trigger="mount" stagger={0.14} delayChildren={0.05} className="mx-auto max-w-lg">
        {isNew ? (
          <StaggerItem variants={scaleInItem} className="mb-8 text-center">
            <h1 className="text-3xl font-bold">You&apos;re in!</h1>
            <p className="mt-2 text-muted-foreground">Your slot is confirmed. We&apos;ve emailed this ticket to you as well.</p>
          </StaggerItem>
        ) : (
          <StaggerItem variants={fadeUpItem} className="mb-8 text-center print-hidden">
            <h1 className="text-3xl font-bold">Your ticket</h1>
          </StaggerItem>
        )}
        <StaggerItem variants={fadeUpItem}>
          <DigitalTicket ticket={ticket} qrImage={qr} />
        </StaggerItem>
        <StaggerItem className="print-hidden mt-8 flex flex-col gap-3">
          <Button size="lg" variant="outline" asChild className="w-full">
            <Link href="/sessions">
              Browse more sessions
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
          {!customer && (
            <p className="text-center text-sm text-muted-foreground">
              <Link href="/signup" className="text-primary hover:underline">Create an account</Link> to keep all your tickets in one place.
            </p>
          )}
        </StaggerItem>
      </StaggerGroup>
    </main>
  )
}
