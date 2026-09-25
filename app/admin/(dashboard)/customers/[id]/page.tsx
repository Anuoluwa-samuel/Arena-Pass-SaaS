import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/shared/page-header"
import { TicketStatusBadge } from "@/components/shared/status-badge"
import { StatCard } from "@/components/admin/stat-card"
import { DataTable } from "@/components/admin/data-table"
import { CustomerEditor } from "@/components/admin/customer-editor"
import { requireArenaPermission } from "@/server/auth/rbac"
import { getCustomerDetail } from "@/server/services/customers"
import { AppError } from "@/server/http/errors"
import { formatDateTime, formatMoney } from "@/lib/format"
import { GENDER_LABELS, POSITION_LABELS, SKILL_LABELS, type Gender, type Position, type SkillLevel } from "@/lib/domain/profile"

export const metadata = { title: "Customer" }

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { arena } = await requireArenaPermission("customers.view")
  const { id } = await params
  let data: Awaited<ReturnType<typeof getCustomerDetail>>
  try {
    data = await getCustomerDetail(arena.arenaId, id)
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound()
    throw err
  }
  const { customer, tickets } = data
  const spent = tickets.filter((t) => ["CONFIRMED", "USED"].includes(t.ticket.status)).reduce((n, t) => n + t.ticket.price, 0)
  const currency = tickets[0]?.ticket.currency ?? "NGN"
  return (
    <div className="space-y-6">
      <Link href="/admin/customers" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />All customers</Link>
      <PageHeader title={customer.name} description={`${customer.email}${customer.phone ? ` · ${customer.phone}` : ""}`} />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Tickets" value={tickets.length} />
        <StatCard label="Total spent" value={formatMoney(spent, currency)} tone="primary" />
        <StatCard label="Attended" value={tickets.filter((t) => t.ticket.status === "USED").length} sub="scanned in at the arena" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.6fr]">
        <div className="space-y-6">
          <CustomerEditor customer={{ id: customer.id, name: customer.name, phone: customer.phone ?? "", isActive: customer.isActive }} canManage={arena.permissions.includes("customers.manage")} />
          <Card>
            <CardHeader><CardTitle className="text-base">Player profile</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {[
                  ["Username", customer.username ? `@${customer.username}` : null],
                  ["Date of birth", customer.dateOfBirth],
                  ["Gender", customer.gender ? GENDER_LABELS[customer.gender as Gender] : null],
                  ["Area / city", customer.city],
                  ["Position", customer.preferredPosition ? POSITION_LABELS[customer.preferredPosition as Position] : null],
                  ["Skill level", customer.skillLevel ? SKILL_LABELS[customer.skillLevel as SkillLevel] : null],
                  ["Emergency contact", customer.emergencyContactName],
                  ["Emergency phone", customer.emergencyContactPhone],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className={value ? "truncate" : "text-muted-foreground"}>{value ?? "—"}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">Ticket history</CardTitle></CardHeader>
          <CardContent>
            <DataTable
              rows={tickets}
              rowKey={(t) => t.ticket.id}
              mobileTitle={(t) => <span className="font-mono">{t.ticket.ticketNumber}</span>}
              empty={<p className="py-8 text-center text-sm text-muted-foreground">No tickets yet.</p>}
              columns={[
                { key: "n", header: "Ticket", hideOnMobile: true, cell: (t) => <Link href={`/tickets/${t.ticket.ticketNumber}`} target="_blank" className="font-mono text-sm hover:underline">{t.ticket.ticketNumber}</Link> },
                { key: "s", header: "Session", cell: (t) => <Link href={`/admin/sessions/${t.session.id}`} className="hover:underline">{t.session.title}</Link> },
                { key: "d", header: "Kick-off", cell: (t) => formatDateTime(t.session.startsAt) },
                { key: "p", header: "Paid", cell: (t) => formatMoney(t.ticket.price, t.ticket.currency) },
                { key: "st", header: "Status", cell: (t) => <TicketStatusBadge status={t.ticket.status} /> },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
