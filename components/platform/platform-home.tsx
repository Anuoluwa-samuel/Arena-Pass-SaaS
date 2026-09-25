import Link from "next/link"
import { CreditCard, QrCode, ShieldCheck, Ticket, Users } from "lucide-react"
import { ArrowButton } from "@/components/ui/arrow-button"
import { BlurText, Reveal, StaggerGroup, StaggerItem } from "@/components/motion"
import { Magnetic } from "@/components/magnetic"
import { SectionLabel } from "@/components/shared/section-label"
import { ThemeToggle } from "@/components/theme-toggle"

/**
 * The platform's front door.
 *
 * Shown at the root of a hostname that belongs to no arena — the apex domain,
 * where an operator arrives before they have a tenant at all. It deliberately
 * reads nothing from the database: there is no arena here, so there is no CMS
 * content, no branding and no session list to show. Everything on this page is
 * about the product itself.
 *
 * It does not list existing arenas. A public directory of every tenant is a
 * product decision with a privacy edge to it — some operators would not want
 * their venue advertised on somebody else's marketing page — so arenas are
 * reachable at their own hostnames and nowhere else until that is asked for.
 */

const capabilities = [
  {
    icon: Users,
    title: "Sessions and teams",
    body: "Publish a session, set the capacity and the price, and let the system allocate players into balanced teams as they book.",
  },
  {
    icon: CreditCard,
    title: "You get paid directly",
    body: "Connect your own payment account. Money goes from your customers to you — the platform never sits between you and it.",
  },
  {
    icon: Ticket,
    title: "Tickets that hold up",
    body: "Every paid booking issues a digital ticket immediately. No spreadsheets, no manual list at the gate.",
  },
  {
    icon: QrCode,
    title: "Scan at the gate",
    body: "Staff validate a QR code from any phone. A ticket can be used once, and a second scan says so.",
  },
]

export function PlatformHome({ rootDomain }: { rootDomain: string }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
        <span className="font-display text-xl font-semibold uppercase tracking-tight">Game Slots</span>
        <div className="flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          <Link
            href="/admin/login"
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* ------------------------------------------------------------ Hero */}
      <section className="relative isolate overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_55%_at_50%_0%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_72%)]"
        />
        <div className="mx-auto max-w-4xl px-4 pb-20 pt-10 text-center max-sm:pb-14 sm:px-6 sm:pt-16 lg:px-8">
          <Reveal trigger="mount">
            <SectionLabel className="text-center">Run your own arena</SectionLabel>
          </Reveal>

          <BlurText
            as="h1"
            trigger="mount"
            // `highlight` is appended after `text` and gets the gradient —
            // it is a trailing phrase, not a substring to pick out.
            text="Take bookings. Issue tickets."
            highlight="Run the gate."
            stagger={0.06}
            className="mt-6 text-balance text-[clamp(2.5rem,7vw,5rem)] font-semibold uppercase leading-[0.92]"
          />

          <Reveal trigger="mount" delay={0.4}>
            <p className="mx-auto mt-7 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground max-sm:mt-5 max-sm:text-base">
              Game Slots gives your venue its own booking site, its own payments and its own staff
              accounts. Set up takes a few minutes, and nothing is charged until you launch.
            </p>
          </Reveal>

          <Reveal trigger="mount" delay={0.55}>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 max-sm:mt-7 sm:flex-row">
              <Magnetic>
                <ArrowButton asChild variant="primary">
                  <Link href="/start">Open your arena</Link>
                </ArrowButton>
              </Magnetic>
              <ArrowButton asChild>
                <Link href="/admin/login">I already have one</Link>
              </ArrowButton>
            </div>
          </Reveal>

          <Reveal trigger="mount" delay={0.7}>
            <p className="mt-8 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Your site lives at{" "}
              <span className="text-foreground">your-arena.{rootDomain}</span>
            </p>
          </Reveal>
        </div>
      </section>

      {/* --------------------------------------------------- What you get */}
      <section className="mx-auto w-full max-w-7xl px-4 pb-24 sm:px-6 lg:px-8">
        <Reveal>
          <SectionLabel index={1}>What you get</SectionLabel>
        </Reveal>
        <StaggerGroup className="mt-8 grid gap-4 sm:grid-cols-2">
          {capabilities.map(({ icon: Icon, title, body }) => (
            <StaggerItem key={title}>
              <div className="glass h-full rounded-2xl p-6">
                <span className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary">
                  <Icon className="size-5" />
                </span>
                <h2 className="mt-5 text-lg font-semibold">{title}</h2>
                <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </StaggerItem>
          ))}
        </StaggerGroup>

        <Reveal className="mt-4">
          <div className="glass flex flex-col gap-4 rounded-2xl p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
                <ShieldCheck className="size-5" />
              </span>
              <div>
                <h2 className="text-lg font-semibold">Your data stays yours</h2>
                <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">
                  Every arena is a separate tenant. Your sessions, customers, staff and takings are not
                  visible to any other venue on the platform.
                </p>
              </div>
            </div>
            <div className="shrink-0 max-sm:self-start">
              <Magnetic>
                <ArrowButton asChild variant="primary">
                  <Link href="/start">Get started</Link>
                </ArrowButton>
              </Magnetic>
            </div>
          </div>
        </Reveal>
      </section>

      <footer className="mt-auto border-t">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:px-6 lg:px-8">
          <span>&copy; {new Date().getFullYear()} Game Slots</span>
          <div className="flex gap-5">
            <Link href="/start" className="transition-colors hover:text-foreground">
              Open an arena
            </Link>
            <Link href="/admin/login" className="transition-colors hover:text-foreground">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
