import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/shared/page-header"
import { SessionStatusBadge, BookingStatusBadge } from "@/components/shared/status-badge"
import { TeamGrid } from "@/components/shared/team-grid"
import { StatCard } from "@/components/admin/stat-card"
import { DataTable } from "@/components/admin/data-table"
import { SessionRowActions } from "@/components/admin/session-row-actions"
import { requireArenaPermission } from "@/server/auth/rbac"
import { getSessionWithTeams } from "@/server/services/sessions"
import { listBookingsForSession } from "@/server/services/bookings"
import { AppError } from "@/server/http/errors"
import { formatDateTime, formatMoney, formatTimeRange } from "@/lib/format"

export const metadata = { title: "Session" }

export default async function AdminSessionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { arena } = await requireArenaPermission("sessions.view")
  const { id } = await params
  let data: Awaited<ReturnType<typeof getSessionWithTeams>>
  try {
    data = await getSessionWithTeams(arena.arenaId, id, { includeDraft: true })
  } catch (err) {
    if (err instanceof AppError && err.code === "SESSION_NOT_FOUND") notFound()
    throw err
  }
  const { session, teams } = data
  const bookings = await listBookingsForSession(arena.arenaId, id)
  const byBooking = new Map(bookings.map((b) => [b.booking.id, b]))
  const grid = teams.map((t) => ({
    teamNumber: t.teamNumber,
    name: t.name,
    slots: t.slots.map((s) => {
      const b = s.bookingId ? byBooking.get(s.bookingId) : undefined
      const label = b ? b.booking.playerName.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase() : null
      return { slotNumber: s.slotNumber, taken: s.status !== "FREE", label: label ? `${label}${s.status === "HELD" ? "·" : ""}` : null }
    }),
  }))
  const revenue = bookings.filter((b) => b.booking.status === "CONFIRMED").reduce((n, b) => n + b.booking.amount, 0)

  return (
    <div className="space-y-6">
      <Link href="/admin/sessions" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />All sessions</Link>
      <PageHeader
        eyebrow={session.venue}
        title={session.title}
        description={`${formatDateTime(session.startsAt)} · ${formatTimeRange(session.startsAt, session.endsAt)}`}
        actions={
          <>
            <SessionStatusBadge status={session.effectiveStatus} className="mr-2" />
            {session.status !== "DRAFT" && <Button variant="ghost" size="sm" asChild><Link href={`/sessions/${session.id}`} target="_blank"><ExternalLink className="mr-2 size-4" />Public page</Link></Button>}
          </>
        }
      />
      <SessionRowActions variant="buttons" session={{ id: session.id, title: session.title, status: session.status, bookedCount: session.bookedCount }} canManage={arena.permissions.includes("sessions.manage")} />
      {session.status === "CANCELLED" && session.cancellationReason && <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">Cancelled: {session.cancellationReason}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Confirmed players" value={`${session.bookedCount}/${session.totalCapacity}`} sub={`${session.totalCapacity - session.bookedCount - session.heldCount} slots open`} />
        <StatCard label="Pending holds" value={session.heldCount} sub="reservations awaiting payment" tone={session.heldCount ? "warning" : "default"} />
        <StatCard label="Revenue" value={formatMoney(revenue, session.currency)} sub={`${formatMoney(session.ticketPrice, session.currency)} per player`} tone="primary" />
        <StatCard label="Booking window" value={new Date() < session.bookingOpensAt ? "Not open" : new Date() > session.bookingDeadline ? "Closed" : "Open"} sub={`closes ${formatDateTime(session.bookingDeadline)}`} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Team allocation</CardTitle></CardHeader>
        <CardContent>
          <TeamGrid teams={grid} />
          <p className="mt-3 text-xs text-muted-foreground">Initials mark confirmed players; a trailing dot marks a pending hold.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Bookings ({bookings.length})</CardTitle></CardHeader>
        <CardContent>
          <DataTable
            rows={bookings}
            rowKey={(b) => b.booking.id}
            mobileTitle={(b) => b.booking.playerName}
            empty={<p className="py-8 text-center text-sm text-muted-foreground">No bookings yet.</p>}
            columns={[
              { key: "player", header: "Player", hideOnMobile: true, cell: (b) => <div><p className="font-medium">{b.booking.playerName}</p><p className="text-xs text-muted-foreground">{b.customer.name} · {b.customer.email}</p></div> },
              { key: "slot", header: "Team / slot", cell: (b) => (b.slot ? `Team ${b.slot.teamNumber} · P${b.slot.slotNumber}` : "—") },
              { key: "status", header: "Status", cell: (b) => <BookingStatusBadge status={b.booking.status} /> },
              { key: "amount", header: "Amount", cell: (b) => formatMoney(b.booking.amount, b.booking.currency) },
              { key: "when", header: "Booked", cell: (b) => formatDateTime(b.booking.createdAt) },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  )
}
