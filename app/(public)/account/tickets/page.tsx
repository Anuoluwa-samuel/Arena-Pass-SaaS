import Link from "next/link"
import { redirect } from "next/navigation"
import { Ticket } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { TicketStatusBadge } from "@/components/shared/status-badge"
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion"
import { getCurrentCustomer } from "@/server/auth/session"
import { listTickets } from "@/server/services/tickets"
import { requirePublicTenantForPage } from "@/server/tenant"
import { formatDateTime, formatMoney } from "@/lib/format"

export const dynamic = "force-dynamic"
export const metadata = { title: "My tickets" }

export default async function MyTicketsPage() {
  const customer = await getCurrentCustomer()
  if (!customer) redirect("/login?next=/account/tickets")
  const { items } = await listTickets((await requirePublicTenantForPage()).arenaId, { customerId: customer.id, pageSize: 100 })
  const { upcoming, past } = partitionTickets(items)

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <Reveal trigger="mount">
        <PageHeader eyebrow={`Hi ${customer.name.split(" ")[0]}`} title="My tickets" description="Every session you've booked, with your QR code ready for the gate." />
      </Reveal>
      {items.length === 0 ? (
        <EmptyState className="mt-8" icon={Ticket} title="No tickets yet" description="Book a session and your ticket will appear here." action={<Button asChild><Link href="/sessions">Find a session</Link></Button>} />
      ) : (
        <div className="mt-8 space-y-10">
          <Section title="Upcoming" tickets={upcoming} emptyText="Nothing coming up — time to book your next game." />
          {past.length > 0 && <Section title="Past" tickets={past} />}
        </div>
      )}
    </main>
  )
}

/** Split by kick-off relative to request time (server component: evaluated once per request). */
function partitionTickets(items: Awaited<ReturnType<typeof listTickets>>["items"]) {
  // Request-time clock, not render-time randomness: this is a server component,
  // so it is evaluated once per request rather than on every re-render.
  const cutoff = Date.now() - 3 * 3_600_000
  return {
    upcoming: items.filter((t) => new Date(t.session.startsAt).getTime() >= cutoff),
    past: items.filter((t) => new Date(t.session.startsAt).getTime() < cutoff),
  }
}

function Section({ title, tickets, emptyText }: { title: string; tickets: Awaited<ReturnType<typeof listTickets>>["items"]; emptyText?: string }) {
  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {tickets.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <StaggerGroup trigger="mount" className="grid gap-3">
          {tickets.map(({ ticket, session, slot }) => (
            <StaggerItem key={ticket.id}>
              <Link href={`/tickets/${ticket.ticketNumber}`} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{ticket.ticketNumber}</span>
                    <TicketStatusBadge status={ticket.status} />
                  </div>
                  <p className="mt-1 truncate font-semibold">{session.title}</p>
                  <p className="text-sm text-muted-foreground">{formatDateTime(session.startsAt)} · {session.venue}{slot ? ` · Team ${slot.teamNumber}, player ${slot.slotNumber}` : ""}</p>
                </div>
                <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end">
                  <span className="font-semibold text-primary">{formatMoney(ticket.price, ticket.currency)}</span>
                  <span className="text-sm text-primary">View ticket →</span>
                </div>
              </Link>
            </StaggerItem>
          ))}
        </StaggerGroup>
      )}
    </section>
  )
}
