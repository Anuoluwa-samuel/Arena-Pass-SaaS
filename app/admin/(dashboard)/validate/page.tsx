import { PageHeader } from "@/components/shared/page-header"
import { TicketScanner } from "@/components/admin/ticket-scanner"
import { requireArenaPermission } from "@/server/auth/rbac"
import { listSessions } from "@/server/services/sessions"
import { formatDateTime } from "@/lib/format"

export const metadata = { title: "Ticket validation" }

export default async function ValidatePage() {
  const { arena } = await requireArenaPermission("tickets.validate")
  const now = new Date()
  const { items } = await listSessions({ arenaId: arena.arenaId, from: new Date(now.getTime() - 6 * 3_600_000), to: new Date(now.getTime() + 48 * 3_600_000), pageSize: 20 })
  const sessions = items.filter((s) => s.status !== "DRAFT" && s.status !== "CANCELLED").map((s) => ({ id: s.id, label: `${s.title} · ${formatDateTime(s.startsAt)}` }))
  return (
    <div className="space-y-6">
      <PageHeader title="Ticket validation" description="Scan a QR code or type a ticket number. Admitting marks the ticket as used; a second scan is rejected." />
      <TicketScanner sessions={sessions} />
    </div>
  )
}
