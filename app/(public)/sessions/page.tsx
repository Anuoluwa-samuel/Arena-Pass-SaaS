import Link from "next/link"
import { FilterTabs } from "@/components/site/filter-tabs"
import { CalendarX2 } from "lucide-react"
import { SessionCard } from "@/components/session-card"
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion"
import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { getPublicSessions } from "@/server/services/public-content"
import { requirePublicTenantForPage } from "@/server/tenant"

export const dynamic = "force-dynamic"
export const metadata = { title: "Sessions" }

const FILTERS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open now" },
  { key: "soon", label: "Opening soon" },
] as const

export default async function SessionsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter = "all" } = await searchParams
  const { arena, arenaId } = await requirePublicTenantForPage()
  const all = await getPublicSessions(arenaId)
  const sessions = all.filter((s) => (filter === "open" ? s.status === "OPEN_FOR_BOOKING" : filter === "soon" ? s.status === "PUBLISHED" : true))

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
      <Reveal trigger="mount">
        <PageHeader eyebrow={arena.name} title="Upcoming sessions" description="Every session is 8 teams of 4. Pick one, grab a slot, and we'll see you on the pitch." />
      </Reveal>

      <Reveal trigger="mount" delay={0.15} className="mt-8">
        <FilterTabs
          active={filter}
          items={FILTERS.map((f) => ({
            key: f.key,
            label: f.label,
            href: f.key === "all" ? "/sessions" : `/sessions?filter=${f.key}`,
            count: f.key === "all" ? all.length : all.filter((s) => (f.key === "open" ? s.status === "OPEN_FOR_BOOKING" : s.status === "PUBLISHED")).length,
          }))}
        />
      </Reveal>

      {sessions.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={CalendarX2}
          title={filter === "all" ? "No sessions scheduled yet" : "Nothing here right now"}
          description={filter === "all" ? "Check back soon — new sessions are added every week." : "Try another filter or check back later."}
          action={filter !== "all" ? <Button variant="outline" asChild><Link href="/sessions">Show all sessions</Link></Button> : undefined}
        />
      ) : (
        <StaggerGroup trigger="mount" delayChildren={0.1} className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {sessions.map((session) => (
            <StaggerItem key={session.id} className="h-full">
              <SessionCard session={session} />
            </StaggerItem>
          ))}
        </StaggerGroup>
      )}
    </main>
  )
}
