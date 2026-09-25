import Link from "next/link"
import { CalendarClock, MapPin, Megaphone, Users } from "lucide-react"
import { BlurText, CountUp, Parallax, Reveal, StaggerGroup, StaggerItem } from "@/components/motion"
import { Magnetic } from "@/components/magnetic"
import { Marquee } from "@/components/marquee"
import { ScrollCue } from "@/components/scroll-cue"
import { SessionCard } from "@/components/session-card"
import { Spotlight } from "@/components/spotlight"
import { CountdownTimer } from "@/components/countdown-timer"
import { ArrowButton } from "@/components/ui/arrow-button"
import { SectionLabel } from "@/components/shared/section-label"
import { SessionStatusBadge } from "@/components/shared/status-badge"
import { CmsIcon } from "@/components/site/cms-icon"
import { FaqList } from "@/components/site/faq-list"
import { HeroSteps } from "@/components/site/hero-steps"
import { formatMoney, formatShortDate, formatTimeRange } from "@/lib/format"
import { getCurrentCustomer } from "@/server/auth/session"
import { getFeaturedSessions, getPublicSessions, getPublicSiteContent } from "@/server/services/public-content"
import { PlatformHome } from "@/components/platform/platform-home"
import { requirePublicTenantOrPlatformHome, rootDomain } from "@/server/tenant"

export const dynamic = "force-dynamic"

export default async function LandingPage() {
  const tenant = await requirePublicTenantOrPlatformHome()
  // This hostname belongs to no arena, so there is no storefront to render.
  // The apex is the platform's own front door instead — see
  // `requirePublicTenantOrPlatformHome`.
  if (!tenant) return <PlatformHome rootDomain={rootDomain()} />

  const [content, customer] = await Promise.all([getPublicSiteContent(tenant.arenaId), getCurrentCustomer()])
  const { homepage, services, faqs, announcements, banners } = content
  // CMS buttons are written for visitors. A signed-in customer never needs "Create account" or "Sign in":
  // those buttons point to their dashboard instead.
  const forCustomer = (cta: { label: string; href: string }) =>
    customer && /^\/(signup|login)(\b|\?|$)/.test(cta.href) ? { label: "My dashboard", href: "/account" } : cta
  const primaryCta = forCustomer(homepage.hero.primaryCta)
  const secondaryCta = forCustomer(homepage.hero.secondaryCta)
  const closingCta = forCustomer({ label: homepage.cta.buttonLabel, href: homepage.cta.buttonHref })
  const [featured, sessions] = await Promise.all([
    homepage.featuredSessionsCount > 0 ? getFeaturedSessions(tenant.arenaId, homepage.featuredSessionsCount) : Promise.resolve([]),
    getPublicSessions(tenant.arenaId),
  ])
  // Stats count every public session (same source as the Sessions page), not just the featured few.
  const open = sessions.filter((s) => s.status === "OPEN_FOR_BOOKING")
  const openCount = open.length
  const slotsLeft = open.reduce((n, s) => n + s.availableSlots, 0)
  const playersPerTeam = sessions[0]?.playersPerTeam ?? 4
  const announcement = announcements[0]
  // The soonest session a visitor can act on: open first, else the next one opening.
  const next = open[0] ?? sessions.find((s) => s.status === "PUBLISHED")
  const hasImage = Boolean(homepage.hero.imageUrl)
  // Over a photo, the rail's small mono text needs a frosted backing to stay readable.
  const railPanel = "glass rounded-2xl p-5 [--glass-bg:color-mix(in_oklch,var(--background)_62%,transparent)] dark:[--glass-bg:color-mix(in_oklch,var(--background)_45%,transparent)]"

  // Section numbers follow what is actually rendered, so they never skip.
  let n = 0
  const nextIndex = () => ++n

  const ticker = [
    "Secure payments",
    "Instant QR tickets",
    ...homepage.howItWorks.steps.map((s) => s.title),
    ...services.map((s) => s.title),
  ]

  return (
    <div>
      {announcement && (
        <div className="mx-auto max-w-7xl px-3 pt-4 sm:px-6">
          <Reveal trigger="mount" className="glass flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
              <Megaphone className="size-3.5" />
            </span>
            <p className="min-w-0 truncate">
              <span className="font-semibold text-primary">{announcement.title}</span>
              <span className="text-muted-foreground"> — {announcement.content}</span>
            </p>
          </Reveal>
        </div>
      )}

      {/* ------------------------------------------------------------ Hero */}
      <section className="relative isolate overflow-hidden">
        {hasImage && (
          <div className="absolute inset-0 -z-10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={homepage.hero.imageUrl!} alt="" aria-hidden="true" fetchPriority="high" className="absolute inset-0 size-full object-cover" />
            {/* Scrim fading into the page background. Light mode is thinner so the photo shows through;
                dark mode keeps its original strength. */}
            <div className="absolute inset-0 bg-gradient-to-b from-background/45 via-background/30 to-background dark:from-background/85 dark:via-background/75" />
            {/* Light mode only: a soft glow behind the text keeps it readable over the thinner scrim. */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_62%_45%,color-mix(in_oklch,var(--background)_72%,transparent),transparent_78%)] dark:hidden" />
          </div>
        )}

        <div className="mx-auto grid max-w-7xl gap-14 px-4 pb-24 pt-14 max-sm:gap-10 max-sm:pb-16 max-sm:pt-6 sm:min-h-[calc(100svh-5.5rem)] sm:content-center sm:px-6 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,2fr)] lg:gap-10 lg:px-8">
          {/* Side rail: the play, in steps. */}
          <Reveal trigger="mount" delay={0.35} className="order-2 flex flex-col justify-end lg:order-1 lg:py-4">
            <div className={hasImage ? railPanel : undefined}>
              <SectionLabel>The play</SectionLabel>
              <div className="mt-4">
                <HeroSteps steps={homepage.howItWorks.steps.map((s) => s.title)} />
              </div>
            </div>
          </Reveal>

          {/* Headline block */}
          <div className="order-1 lg:order-2">
            <BlurText
              as="h1"
              trigger="mount"
              text={homepage.hero.title}
              highlight={homepage.hero.highlight}
              stagger={0.07}
              className="text-balance text-[clamp(3.25rem,9vw,7.5rem)] font-semibold uppercase leading-[0.88]"
            />
            <Reveal trigger="mount" delay={0.45}>
              <p
                className={`mt-8 max-w-xl text-pretty text-lg leading-relaxed max-sm:mt-5 max-sm:text-base ${hasImage ? "text-secondary-foreground dark:text-muted-foreground" : "text-muted-foreground"}`}
              >
                {homepage.hero.description}
              </p>
            </Reveal>
            <Reveal trigger="mount" delay={0.6} className="mt-10 flex flex-col gap-3 max-sm:mt-7 sm:flex-row sm:items-center">
              <Magnetic>
                <ArrowButton asChild variant="primary" className="w-full sm:w-auto">
                  <Link href={primaryCta.href}>{primaryCta.label}</Link>
                </ArrowButton>
              </Magnetic>
              <ArrowButton asChild className="w-full sm:w-auto">
                <Link href={secondaryCta.href}>{secondaryCta.label}</Link>
              </ArrowButton>
            </Reveal>

            {/* Next kick-off */}
            {next && (
              <Reveal trigger="mount" delay={0.8} y={28} className="mt-14 max-sm:mt-10">
                {/* Heavier tint than other glass: this card can sit over a bright hero photo. */}
                <Spotlight className="glass rounded-3xl p-2 [--glass-bg:color-mix(in_oklch,var(--background)_62%,transparent)] dark:[--glass-bg:color-mix(in_oklch,var(--background)_45%,transparent)]">
                  <div className="grid gap-2 sm:grid-cols-[1.1fr_1fr]">
                    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/25 via-primary/5 to-transparent p-6 max-sm:p-5">
                      <div aria-hidden="true" className="dot-grid absolute inset-0 opacity-70" />
                      <div className="relative">
                        <div className="flex items-center justify-between gap-3">
                          <SectionLabel>Next kick-off</SectionLabel>
                          <SessionStatusBadge status={next.status} pulse={next.status === "OPEN_FOR_BOOKING"} />
                        </div>
                        <p className="mt-6 font-display text-3xl font-semibold uppercase leading-none max-sm:mt-4 max-sm:text-[1.75rem]">{next.title}</p>
                        <div className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                          <p className="flex items-center gap-2"><CalendarClock className="size-4 text-primary" />{formatShortDate(next.startsAt)} · {formatTimeRange(next.startsAt, next.endsAt)}</p>
                          <p className="flex items-center gap-2"><MapPin className="size-4 text-primary" />{next.venue}</p>
                          <p className="flex items-center gap-2"><Users className="size-4 text-primary" />{next.availableSlots} of {next.totalCapacity} slots left</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col justify-between gap-6 p-5 max-sm:gap-4 max-sm:pt-3">
                      <div>
                        <p className="label-mono text-muted-foreground">{next.status === "OPEN_FOR_BOOKING" ? "Booking closes in" : "Booking opens in"}</p>
                        <div className="mt-3">
                          <CountdownTimer targetDate={new Date(next.status === "OPEN_FOR_BOOKING" ? next.bookingDeadline : next.bookingOpensAt)} variant="compact" />
                        </div>
                      </div>
                      <div className="flex items-end justify-between gap-4">
                        <p className="font-display text-4xl font-semibold text-primary max-sm:text-3xl">{formatMoney(next.ticketPrice, next.currency)}</p>
                        <ArrowButton asChild size="sm" variant={next.status === "OPEN_FOR_BOOKING" ? "primary" : "glass"}>
                          <Link href={`/sessions/${next.id}`}>{next.status === "OPEN_FOR_BOOKING" ? "Book now" : "Details"}</Link>
                        </ArrowButton>
                      </div>
                    </div>
                  </div>
                </Spotlight>
              </Reveal>
            )}
          </div>
        </div>
        <ScrollCue />
      </section>

      {/* ---------------------------------------------------------- Ticker */}
      <div className="border-y border-border/70 py-6 max-sm:py-4">
        <Marquee items={ticker} className="font-display text-2xl font-semibold uppercase text-foreground/85 max-sm:text-xl sm:text-3xl" />
      </div>

      {/* ---------------------------------------------------- Live numbers */}
      {sessions.length > 0 && (
        <section className="py-24 max-sm:py-16 sm:py-32">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-10 max-sm:gap-5 lg:grid-cols-[1fr_1.5fr] lg:items-end">
              <div>
                <Reveal><SectionLabel index={nextIndex()}>Match day</SectionLabel></Reveal>
                <BlurText text="Numbers that move" highlight="every minute" className="mt-5 text-balance text-4xl font-semibold uppercase leading-[1.02] sm:text-5xl" />
              </div>
              <Reveal delay={0.1}>
                <p className="max-w-md text-pretty text-muted-foreground lg:ml-auto">Live from the booking board. Slots go fast once a session opens — these update as players book.</p>
              </Reveal>
            </div>
            <StaggerGroup className="mt-14 grid gap-4 max-sm:mt-8 max-sm:grid-cols-2 max-sm:gap-3 sm:grid-cols-2 lg:grid-cols-4" stagger={0.1}>
              {[
                { value: openCount, label: "Sessions open", note: "Booking right now" },
                { value: slotsLeft, label: "Slots left", note: "Across open sessions" },
                { value: playersPerTeam, label: "Players per team", note: "Every team, every session" },
                { value: sessions.length, label: "Upcoming sessions", note: "On the calendar" },
              ].map((stat) => (
                <StaggerItem key={stat.label}>
                  <Spotlight className="glass group h-full rounded-2xl p-6 transition-transform duration-500 hover:-translate-y-1 max-sm:p-4">
                    <p className="label-mono text-muted-foreground max-sm:min-h-8 max-sm:text-[0.625rem] max-sm:tracking-[0.1em]">{stat.label}</p>
                    <p className="mt-10 font-display text-7xl font-semibold tabular-nums max-sm:mt-3 max-sm:text-5xl">
                      <CountUp value={stat.value} />
                    </p>
                    <p className="mt-3 text-sm text-muted-foreground max-sm:mt-1 max-sm:text-xs">{stat.note}</p>
                    <span aria-hidden="true" className="mt-6 max-sm:mt-4 block h-px w-10 bg-gradient-to-r from-primary to-transparent transition-all duration-500 group-hover:w-full" />
                  </Spotlight>
                </StaggerItem>
              ))}
            </StaggerGroup>
          </div>
        </section>
      )}

      {/* -------------------------------------------------------- Sessions */}
      {featured.length > 0 && (
        <section className="py-24 max-sm:py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-6 max-sm:gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Reveal><SectionLabel index={nextIndex()}>Sessions</SectionLabel></Reveal>
                <BlurText text="Upcoming sessions" className="mt-5 text-4xl font-semibold uppercase sm:text-5xl" />
              </div>
              <Reveal delay={0.1}>
                <ArrowButton asChild>
                  <Link href="/sessions">All sessions</Link>
                </ArrowButton>
              </Reveal>
            </div>
            <StaggerGroup className="mt-12 grid gap-6 max-sm:mt-8 max-sm:gap-4 sm:grid-cols-2 lg:grid-cols-3" stagger={0.1}>
              {featured.map((s) => (
                <StaggerItem key={s.id} className="h-full">
                  <SessionCard session={s} />
                </StaggerItem>
              ))}
            </StaggerGroup>
          </div>
        </section>
      )}

      {/* ---------------------------------------------------- How it works */}
      <section className="py-24 max-sm:py-16 sm:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <Reveal><SectionLabel index={nextIndex()}>How it works</SectionLabel></Reveal>
            <BlurText text={homepage.howItWorks.title} className="mt-5 text-balance text-4xl font-semibold uppercase leading-[1.02] sm:text-5xl" />
            <Reveal delay={0.1}><p className="mt-5 text-lg text-muted-foreground max-sm:mt-3 max-sm:text-base">{homepage.howItWorks.subtitle}</p></Reveal>
          </div>
          <div className="relative mt-16 max-sm:mt-8">
            {/* Connector that draws itself across the steps on wide screens. */}
            <Reveal className="absolute inset-x-[8%] top-[3.25rem] hidden h-px origin-left bg-gradient-to-r from-primary/0 via-primary/60 to-primary/0 lg:block" y={0}>
              <span />
            </Reveal>
            <StaggerGroup className="grid gap-4 max-sm:gap-3 lg:grid-cols-3" stagger={0.14}>
              {homepage.howItWorks.steps.map((step, i) => (
                <StaggerItem key={i} className="h-full">
                  <Spotlight className="glass group relative h-full rounded-2xl p-7 transition-transform duration-500 hover:-translate-y-1 max-sm:p-5">
                    <div className="flex items-center justify-between">
                      <div className="relative grid size-14 max-sm:size-11 place-items-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/25 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-[-4deg]">
                        <span aria-hidden="true" className="absolute inset-0 rounded-2xl bg-primary/30 opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100" />
                        <CmsIcon name={step.icon} className="relative size-6" />
                      </div>
                      <span className="font-display text-6xl font-semibold text-foreground/10 max-sm:text-5xl transition-colors duration-500 group-hover:text-primary/40">{String(i + 1).padStart(2, "0")}</span>
                    </div>
                    <h3 className="mt-8 text-2xl font-semibold uppercase max-sm:mt-4 max-sm:text-xl">{step.title}</h3>
                    <p className="mt-2 leading-relaxed text-muted-foreground max-sm:mt-1 max-sm:text-sm">{step.description}</p>
                  </Spotlight>
                </StaggerItem>
              ))}
            </StaggerGroup>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- Services */}
      {services.length > 0 && (
        <section className="py-24 max-sm:py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-8 max-sm:gap-4 lg:grid-cols-[1fr_1.2fr] lg:items-end">
              <div>
                <Reveal><SectionLabel index={nextIndex()}>Services</SectionLabel></Reveal>
                <BlurText text={content.servicesPage.title} className="mt-5 text-balance text-4xl font-semibold uppercase leading-[1.02] sm:text-5xl" />
              </div>
              <Reveal delay={0.1}><p className="max-w-lg text-pretty text-lg text-muted-foreground max-sm:text-base lg:ml-auto">{content.servicesPage.subtitle}</p></Reveal>
            </div>
            <StaggerGroup className="mt-14 grid gap-4 max-sm:mt-8 max-sm:gap-3 sm:grid-cols-2 lg:grid-cols-4" stagger={0.08}>
              {services.map((s, i) => (
                <StaggerItem key={s.id} className="h-full">
                  <Spotlight className="glass group h-full rounded-2xl p-6 transition-transform duration-500 hover:-translate-y-1 max-sm:p-5">
                    <div className="flex items-start justify-between">
                      <span className="grid size-11 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20 transition-transform duration-500 group-hover:scale-110">
                        <CmsIcon name={s.icon} className="size-5" />
                      </span>
                      <span className="label-mono text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                    </div>
                    <h3 className="mt-8 text-xl font-semibold uppercase max-sm:mt-4 max-sm:text-lg">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.description}</p>
                  </Spotlight>
                </StaggerItem>
              ))}
            </StaggerGroup>
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------- Banner */}
      {banners[0] && (
        <section className="pb-24 max-sm:pb-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <Reveal y={24} className="glass relative overflow-hidden rounded-3xl">
              {banners[0].imageUrl && (
                <Parallax distance={30} className="absolute inset-[-10%]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={banners[0].imageUrl} alt="" className="size-full object-cover opacity-30" />
                </Parallax>
              )}
              <div className="relative flex flex-col items-start gap-6 p-8 max-sm:gap-5 max-sm:p-6 sm:flex-row sm:items-center sm:justify-between sm:p-12">
                <div>
                  <h3 className="text-4xl font-semibold uppercase max-sm:text-3xl">{banners[0].title}</h3>
                  {banners[0].subtitle && <p className="mt-2 text-muted-foreground">{banners[0].subtitle}</p>}
                </div>
                {banners[0].linkUrl && (
                  <ArrowButton asChild variant="primary">
                    <Link href={banners[0].linkUrl}>{banners[0].linkLabel || "Learn more"}</Link>
                  </ArrowButton>
                )}
              </div>
            </Reveal>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------- FAQ */}
      {faqs.length > 0 && (
        <section className="py-24 max-sm:py-16">
          <div className="mx-auto grid max-w-7xl gap-12 max-sm:gap-8 px-4 sm:px-6 lg:grid-cols-[1fr_1.6fr] lg:px-8">
            <div>
              <Reveal><SectionLabel index={nextIndex()}>FAQ</SectionLabel></Reveal>
              <BlurText text="Questions," highlight="answered" className="mt-5 text-4xl font-semibold uppercase sm:text-5xl" />
              <Reveal delay={0.1}>
                <p className="mt-5 text-muted-foreground">Everything you need to know before your first session.</p>
                <ArrowButton asChild className="mt-8 max-sm:mt-6">
                  <Link href="/faq">See all FAQs</Link>
                </ArrowButton>
              </Reveal>
            </div>
            <FaqList faqs={faqs.slice(0, 4)} />
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------- CTA */}
      <section className="py-24 max-sm:pb-12 max-sm:pt-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal y={32} className="glass relative isolate overflow-hidden rounded-[2rem] px-6 py-20 text-center max-sm:px-5 max-sm:py-14 sm:px-12 sm:py-28">
            <div aria-hidden="true" className="absolute inset-0 -z-10">
              <div className="animate-glow-breathe absolute -bottom-1/2 left-1/2 h-[120%] w-[80%] -translate-x-1/2 rounded-full bg-primary/40 blur-[100px]" />
              <div className="dot-grid absolute inset-0" />
            </div>
            <SectionLabel className="justify-center">Kick-off</SectionLabel>
            <BlurText text={homepage.cta.title} className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-semibold uppercase leading-[1.02] sm:text-6xl" />
            <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground max-sm:mt-4 max-sm:text-base">{homepage.cta.description}</p>
            <div className="mt-10 flex justify-center max-sm:mt-8">
              <Magnetic>
                <ArrowButton asChild variant="primary">
                  <Link href={closingCta.href}>{closingCta.label}</Link>
                </ArrowButton>
              </Magnetic>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  )
}
