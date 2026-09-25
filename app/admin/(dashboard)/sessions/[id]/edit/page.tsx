import { notFound } from "next/navigation"
import { PageHeader } from "@/components/shared/page-header"
import { SessionForm } from "@/components/admin/session-form"
import { requireArenaPermission } from "@/server/auth/rbac"
import { getSessionById } from "@/server/services/sessions"
import { getSettings } from "@/server/services/settings"
import { AppError } from "@/server/http/errors"
import { toDatetimeLocalValue } from "@/lib/format"

export const metadata = { title: "Edit session" }

export default async function EditSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { arena } = await requireArenaPermission("sessions.manage")
  const { id } = await params
  let session
  try {
    session = await getSessionById(arena.arenaId, id, { includeDraft: true })
  } catch (err) {
    if (err instanceof AppError && err.code === "SESSION_NOT_FOUND") notFound()
    throw err
  }
  const settings = await getSettings(session.arenaId)
  return (
    <div className="space-y-6">
      <PageHeader title={`Edit: ${session.title}`} description="Changes apply immediately to the public session page." />
      <SessionForm
        mode="edit"
        sessionId={session.id}
        locked={session.bookedCount + session.heldCount > 0}
        defaults={{ teamsCount: settings.defaultTeamsCount, playersPerTeam: settings.defaultPlayersPerTeam, ticketPriceMajor: settings.defaultTicketPrice / 100, currency: session.currency }}
        initial={{
          title: session.title,
          description: session.description ?? "",
          venue: session.venue,
          startsAt: toDatetimeLocalValue(session.startsAt),
          endsAt: toDatetimeLocalValue(session.endsAt),
          bookingOpensAt: toDatetimeLocalValue(session.bookingOpensAt),
          bookingDeadline: toDatetimeLocalValue(session.bookingDeadline),
          teamsCount: session.teamsCount,
          playersPerTeam: session.playersPerTeam,
          ticketPriceMajor: session.ticketPrice / 100,
        }}
      />
    </div>
  )
}
