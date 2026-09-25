import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Calendar, Clock, MapPin, Users, ShieldCheck, Zap, QrCode } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Reveal } from "@/components/motion"
import { SessionStatusBadge } from "@/components/shared/status-badge"
import { TeamGrid } from "@/components/shared/team-grid"
import { MobileBookBar, SessionActions } from "@/components/site/session-actions"
import { formatDate, formatMoney, formatTimeRange } from "@/lib/format"
import { getSessionWithTeams } from "@/server/services/sessions"
import { toPublicSession, toPublicTeams } from "@/server/serializers"
import { AppError } from "@/server/http/errors"
import { requirePublicTenantForPage } from "@/server/tenant"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const tenant = await requirePublicTenantForPage()
    const { session } = await getSessionWithTeams(tenant.arenaId, id)
    return { title: session.title, description: `${formatDate(session.startsAt)} at ${session.venue}` }
  } catch {
    return { title: "Session not found" }
  }
}

export default async function SessionDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let data: Awaited<ReturnType<typeof getSessionWithTeams>>
  try {
    data = await getSessionWithTeams((await requirePublicTenantForPage()).arenaId, id)
  } catch (err) {
    if (err instanceof AppError && err.code === "SESSION_NOT_FOUND") notFound()
    throw err
  }
  const session = toPublicSession(data.session)
  const teams = toPublicTeams(data.teams)

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 max-sm:pb-28 max-sm:pt-6 sm:px-6 lg:px-8">
      <Link href="/sessions" className="mb-6 max-sm:mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Back to sessions
      </Link>

      <Reveal trigger="mount" className="mb-8 flex flex-col gap-4 max-sm:mb-6 max-sm:gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <SessionStatusBadge status={session.status} pulse />
          <h1 className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl">{session.title}</h1>
          <p className="mt-2 flex items-center gap-2 text-muted-foreground">
            <MapPin className="size-4" />
            {session.venue}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-sm text-muted-foreground">Per player</p>
          <p className="text-3xl font-bold text-primary">{formatMoney(session.ticketPrice, session.currency)}</p>
        </div>
      </Reveal>

      <div className="grid gap-8 max-sm:gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6 max-sm:space-y-4">
          <Reveal trigger="mount" delay={0.08}>
            <Card>
              <CardHeader>
                <CardTitle>Session details</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-5 max-sm:gap-3.5 sm:grid-cols-2">
                <Detail icon={Calendar} label="Date" value={formatDate(session.startsAt)} />
                <Detail icon={Clock} label="Kick-off" value={formatTimeRange(session.startsAt, session.endsAt)} />
                <Detail icon={Users} label="Format" value={`${session.teamsCount} teams × ${session.playersPerTeam} players`} />
                <Detail
                  icon={Zap}
                  label="Availability"
                  value={
                    <span>
                      <span className={session.availableSlots <= 5 && session.availableSlots > 0 ? "font-semibold text-destructive" : "font-semibold"}>{session.availableSlots}</span>
                      <span className="text-muted-foreground"> of {session.totalCapacity} slots left</span>
                    </span>
                  }
                />
                {session.description && <p className="text-pretty leading-relaxed text-muted-foreground sm:col-span-2">{session.description}</p>}
              </CardContent>
            </Card>
          </Reveal>

          <Reveal trigger="mount" delay={0.14}>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 max-sm:gap-2">
                <CardTitle>Team board</CardTitle>
                <p className="text-sm text-muted-foreground max-sm:shrink-0 max-sm:text-xs">
                  <span className="mr-3 inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-primary/30" />Taken</span>
                  <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm border border-dashed border-border" />Open</span>
                </p>
              </CardHeader>
              <CardContent>
                <TeamGrid teams={teams} />
                <p className="mt-4 text-sm text-muted-foreground">Teams fill evenly as players book. You can request a team at checkout if it still has space.</p>
              </CardContent>
            </Card>
          </Reveal>
        </div>

        <div id="book" className="space-y-6 max-sm:scroll-mt-24 max-sm:space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Reveal trigger="mount" delay={0.1}>
            <SessionActions session={session} teams={teams} />
          </Reveal>
          <Reveal trigger="mount" delay={0.2}>
            <ul className="space-y-3 rounded-2xl border border-border bg-card/60 p-5 text-sm text-muted-foreground">
              <li className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />Slot is held for 10 minutes while you pay. Payment is verified before your ticket is issued.</li>
              <li className="flex items-start gap-3"><QrCode className="mt-0.5 size-4 shrink-0 text-primary" />Your digital ticket with QR code is emailed instantly and available in your account.</li>
              <li className="flex items-start gap-3"><Users className="mt-0.5 size-4 shrink-0 text-primary" />Booking one slot books one player. Bringing friends? Book a slot for each of them.</li>
            </ul>
          </Reveal>
        </div>
      </div>
      <MobileBookBar session={session} teams={teams} />
    </main>
  )
}

function Detail({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 max-sm:gap-2.5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary max-sm:size-8">
        <Icon className="size-5 text-muted-foreground max-sm:size-4" />
      </div>
      <div className="max-sm:min-w-0 max-sm:text-sm">
        <p className="text-sm text-muted-foreground max-sm:text-xs">{label}</p>
        <p className="font-medium">{value}</p>
      </div>
    </div>
  )
}
