import Link from "next/link"
import { redirect } from "next/navigation"
import { CalendarClock, MapPin, Shirt, Ticket, Trophy, UserRound } from "lucide-react"
import { BlurText, CountUp, Reveal, StaggerGroup, StaggerItem } from "@/components/motion"
import { SessionCard } from "@/components/session-card"
import { Spotlight } from "@/components/spotlight"
import { CountdownTimer } from "@/components/countdown-timer"
import { ArrowButton } from "@/components/ui/arrow-button"
import { SectionLabel } from "@/components/shared/section-label"
import { getCurrentCustomer } from "@/server/auth/session"
import { getCustomerProfile } from "@/server/services/profile"
import { getPublicSessions } from "@/server/services/public-content"
import { listTickets } from "@/server/services/tickets"
import { formatShortDate, formatTimeRange } from "@/lib/format"
import { requirePublicTenantForPage } from "@/server/tenant"

export const dynamic = "force-dynamic"
export const metadata = { title: "Home" }

/** Profile fields that make a customer easy to reach and to place in a team. */
const PROFILE_CHECKLIST = [
  { key: "username", label: "Username" },
  { key: "phone", label: "Phone" },
  { key: "dateOfBirth", label: "Date of birth" },
  { key: "preferredPosition", label: "Position" },
  { key: "emergencyContactPhone", label: "Emergency contact" },
] as const

export default async function AccountHomePage() {
  const customer = await getCurrentCustomer()
  if (!customer) redirect("/login?next=/account")

  const tenant = await requirePublicTenantForPage()
  const [profile, { items: tickets }, sessions] = await Promise.all([
    getCustomerProfile(customer.id),
    listTickets(tenant.arenaId, { customerId: customer.id, pageSize: 100 }),
    getPublicSessions(tenant.arenaId),
  ])
  // eslint-disable-next-line react-hooks/purity -- request-time clock in a server component
  const now = Date.now()
  const upcoming = tickets
    .filter((t) => t.ticket.status === "CONFIRMED" && new Date(t.session.endsAt).getTime() > now)
    .sort((a, b) => new Date(a.session.startsAt).getTime() - new Date(b.session.startsAt).getTime())
  const next = upcoming[0]
  const played = tickets.filter((t) => t.ticket.status === "USED").length
  const open = sessions.filter((s) => s.status === "OPEN_FOR_BOOKING").slice(0, 3)
  const missing = PROFILE_CHECKLIST.filter((f) => !profile[f.key])
  const completion = Math.round(((PROFILE_CHECKLIST.length - missing.length) / PROFILE_CHECKLIST.length) * 100)
  const firstName = customer.name.split(" ")[0]

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 max-sm:pt-8 sm:px-6 sm:py-14 lg:px-8">
      <Reveal trigger="mount">
        <p className="label-mono text-muted-foreground"><span className="text-primary">/</span>{profile.username ? `@${profile.username}` : "Welcome back"}</p>
      </Reveal>
      <BlurText as="h1" trigger="mount" text={`Hi, ${firstName}`} className="mt-3 text-5xl font-semibold uppercase leading-[0.95] sm:text-7xl" />
      <Reveal trigger="mount" delay={0.2}>
        <p className="mt-4 max-w-xl text-muted-foreground">{next ? "Your next game is locked in. Here's everything you need." : "Ready for your next game? Grab a slot before they're gone."}</p>
      </Reveal>

      {missing.length > 0 && (
        <Reveal trigger="mount" delay={0.3} className="mt-8 max-sm:mt-6">
          <Spotlight className="glass flex flex-col gap-5 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/25"><UserRound className="size-5" /></span>
              <div>
                <p className="font-medium">Complete your profile · {completion}%</p>
                <p className="mt-1 text-sm text-muted-foreground">Add your {missing.map((m) => m.label.toLowerCase()).join(", ")} so the arena can reach you and place you well.</p>
                <div className="mt-3 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-foreground/[0.08]" role="meter" aria-label="Profile completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion}>
                  <div className="h-full rounded-full bg-gradient-to-r from-primary to-[var(--streak-core)]" style={{ width: `${completion}%` }} />
                </div>
              </div>
            </div>
            <ArrowButton asChild size="sm" variant="primary" className="self-start sm:self-auto">
              <Link href="/account/profile">Update profile</Link>
            </ArrowButton>
          </Spotlight>
        </Reveal>
      )}

      <div className="mt-10 grid gap-4 max-sm:mt-4 max-sm:gap-3 lg:grid-cols-[1.6fr_1fr]">
        <Reveal trigger="mount" delay={0.35}>
          <Spotlight className="glass h-full rounded-3xl p-6 max-sm:p-5 sm:p-8">
            <SectionLabel>Next match</SectionLabel>
            {next ? (
              <div className="mt-5 grid gap-6 sm:grid-cols-[1.2fr_1fr] sm:items-end">
                <div>
                  <p className="font-display text-4xl font-semibold uppercase leading-none max-sm:text-3xl">{next.session.title}</p>
                  <div className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                    <p className="flex items-center gap-2"><CalendarClock className="size-4 text-primary" />{formatShortDate(next.session.startsAt)} · {formatTimeRange(next.session.startsAt, next.session.endsAt)}</p>
                    <p className="flex items-center gap-2"><MapPin className="size-4 text-primary" />{next.session.venue}</p>
                    {next.slot && <p className="flex items-center gap-2"><Shirt className="size-4 text-primary" />Team {next.slot.teamNumber} · Player {next.slot.slotNumber}</p>}
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="label-mono text-muted-foreground">Kick-off in</p>
                    <div className="mt-2"><CountdownTimer targetDate={new Date(next.session.startsAt)} variant="compact" /></div>
                  </div>
                  <ArrowButton asChild variant="primary" size="sm">
                    <Link href={`/tickets/${next.ticket.ticketNumber}`}>View ticket</Link>
                  </ArrowButton>
                </div>
              </div>
            ) : (
              <div className="mt-5 flex flex-col items-start gap-5">
                <p className="font-display text-4xl font-semibold uppercase leading-none text-muted-foreground max-sm:text-3xl">No games booked</p>
                <ArrowButton asChild variant="primary" size="sm">
                  <Link href="/sessions">Find a session</Link>
                </ArrowButton>
              </div>
            )}
          </Spotlight>
        </Reveal>

        <StaggerGroup trigger="mount" delayChildren={0.4} className="grid grid-cols-2 gap-4 max-sm:gap-3 lg:grid-cols-1">
          {[
            { label: "Upcoming games", value: upcoming.length, icon: CalendarClock },
            { label: "Games played", value: played, icon: Trophy },
          ].map((stat) => (
            <StaggerItem key={stat.label} className="h-full">
              <Spotlight className="glass flex h-full flex-col justify-between rounded-2xl p-5 max-sm:p-4">
                <div className="flex items-center justify-between max-sm:gap-2">
                  <p className="label-mono text-muted-foreground max-sm:text-[0.625rem] max-sm:tracking-[0.1em]">{stat.label}</p>
                  <stat.icon className="size-4 shrink-0 text-primary" />
                </div>
                <p className="mt-6 max-sm:mt-3 max-sm:text-5xl font-display text-6xl font-semibold tabular-nums"><CountUp value={stat.value} /></p>
              </Spotlight>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </div>

      <section className="mt-16 max-sm:mt-12">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <SectionLabel>Book again</SectionLabel>
            <h2 className="mt-3 text-4xl font-semibold uppercase max-sm:text-3xl">Open sessions</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <ArrowButton asChild size="sm">
              <Link href="/account/tickets">My tickets</Link>
            </ArrowButton>
            <ArrowButton asChild size="sm">
              <Link href="/sessions">All sessions</Link>
            </ArrowButton>
          </div>
        </div>
        {open.length === 0 ? (
          <Reveal className="glass mt-8 flex items-center gap-3 rounded-2xl p-6 text-muted-foreground"><Ticket className="size-5 text-primary" />No sessions are open for booking right now. Check back soon.</Reveal>
        ) : (
          <StaggerGroup className="mt-8 grid gap-6 max-sm:mt-6 max-sm:gap-4 sm:grid-cols-2 lg:grid-cols-3" stagger={0.1}>
            {open.map((s) => (
              <StaggerItem key={s.id} className="h-full">
                <SessionCard session={s} />
              </StaggerItem>
            ))}
          </StaggerGroup>
        )}
      </section>
    </main>
  )
}
