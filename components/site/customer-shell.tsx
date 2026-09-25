"use client"

import { useEffect, useState, type ComponentType, type ReactNode } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { AnimatePresence, motion, type Transition } from "motion/react"
import { useReducedMotionSafe } from "@/hooks/use-mobile"
import { CalendarDays, ChevronsLeft, CircleHelp, House, LogOut, Mail, Menu, Ticket, UserRound } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ThemeToggle } from "@/components/theme-toggle"
import { api } from "@/lib/api-client"
import { initials } from "@/lib/format"
import { DURATION, EASE_OUT, STAGGER } from "@/lib/motion"
import { SIDEBAR_COOKIE } from "@/lib/sidebar"
import { cn } from "@/lib/utils"

type Icon = ComponentType<{ className?: string }>

interface NavItem {
  href: string
  label: string
  icon: Icon
  /** Active only on this exact path (the account home would otherwise light up on every /account/* page). */
  exact?: boolean
}

/** Everything a signed-in customer does, together at the top. */
const NAV: NavItem[] = [
  { href: "/account", label: "Home", icon: House, exact: true },
  { href: "/sessions", label: "Sessions", icon: CalendarDays },
  { href: "/account/tickets", label: "My Tickets", icon: Ticket },
  { href: "/account/profile", label: "Profile", icon: UserRound },
]

/** Help links, grouped under their own label. */
const HELP_NAV: NavItem[] = [
  { href: "/faq", label: "FAQ", icon: CircleHelp },
  { href: "/contact", label: "Contact", icon: Mail },
]

const EXPANDED_WIDTH = 256
const COLLAPSED_WIDTH = 76

interface Customer {
  name: string
  email: string
  username: string | null
}

function useSpring(): Transition {
  const reduce = useReducedMotionSafe()
  return reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 36, mass: 0.8 }
}

const drawerItem = {
  hidden: { opacity: 0, x: -14 },
  show: { opacity: 1, x: 0, transition: { duration: DURATION.base, ease: EASE_OUT } },
}

/** Row wrapper that joins the drawer's cascade. Module-level so rows keep their identity across renders. */
function CascadeItem({ cascade, children }: { cascade: boolean; children: ReactNode }) {
  return <motion.div variants={cascade ? drawerItem : undefined}>{children}</motion.div>
}

interface RowProps {
  label: string
  icon: Icon
  collapsed: boolean
  href?: string
  active?: boolean
  tone?: "default" | "destructive"
  /** Shared-layout id for the sliding active pill; separate per sidebar instance. */
  indicatorId?: string
  onClick?: () => void
}

/** One sidebar entry — a link or a button — with the sliding active pill and a tooltip when collapsed. */
function SidebarRow({ label, icon: RowIcon, collapsed, href, active = false, tone = "default", indicatorId, onClick }: RowProps) {
  const reduce = useReducedMotionSafe()
  const spring = useSpring()
  const className = cn(
    "group relative isolate flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "text-primary"
      : tone === "destructive"
        ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
  )
  const content = (
    <>
      {active && indicatorId && (
        <motion.span
          layoutId={indicatorId}
          aria-hidden="true"
          className="absolute inset-0 -z-10 rounded-xl bg-primary/10 ring-1 ring-inset ring-primary/25"
          transition={spring}
        />
      )}
      <RowIcon className="size-5 shrink-0 transition-transform duration-200 ease-out group-hover:scale-110" />
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.span
            key="label"
            className="truncate whitespace-nowrap"
            initial={reduce ? false : { opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? undefined : { opacity: 0, x: -8 }}
            transition={{ duration: DURATION.fast, ease: EASE_OUT }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </>
  )
  // Icon-only when collapsed, so the label moves into the accessible name.
  const nameWhenCollapsed = collapsed ? label : undefined
  const element = href ? (
    <Link href={href} onClick={onClick} aria-current={active ? "page" : undefined} aria-label={nameWhenCollapsed} className={className}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onClick} aria-label={nameWhenCollapsed} className={className}>
      {content}
    </button>
  )
  if (!collapsed) return element
  return (
    <Tooltip>
      <TooltipTrigger asChild>{element}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={14}>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Header chevron that collapses/expands the desktop sidebar; flips direction with a spring. */
function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const spring = useSpring()
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          id="customer-sidebar-toggle"
          type="button"
          onClick={onToggle}
          aria-label={label}
          aria-expanded={!collapsed}
          aria-controls="customer-sidebar"
          aria-keyshortcuts="Control+B Meta+B"
          className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <motion.span className="grid place-items-center" animate={{ rotate: collapsed ? 180 : 0 }} transition={spring}>
            <ChevronsLeft className="size-5" />
          </motion.span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={12}>
        {label} <span className="ml-1 opacity-60">Ctrl/⌘ B</span>
      </TooltipContent>
    </Tooltip>
  )
}

interface BodyProps {
  customer: Customer
  siteName: string
  collapsed: boolean
  indicatorId: string
  /** Mobile drawer: rows cascade in. */
  stagger?: boolean
  onNavigate?: () => void
  onSignOut: () => void
  collapseControl?: ReactNode
}

/** Logo, links and account area — shared by the desktop sidebar and the mobile drawer. */
function SidebarBody({ customer, siteName, collapsed, indicatorId, stagger = false, onNavigate, onSignOut, collapseControl }: BodyProps) {
  const pathname = usePathname()
  const reduce = useReducedMotionSafe()
  const isActive = ({ href, exact }: NavItem) => pathname === href || (!exact && pathname.startsWith(`${href}/`))
  const cascade = stagger && !reduce

  return (
    <motion.div
      className="flex h-full min-h-0 flex-col"
      initial={cascade ? "hidden" : false}
      animate={cascade ? "show" : undefined}
      variants={cascade ? { hidden: {}, show: { transition: { staggerChildren: STAGGER * 0.6, delayChildren: 0.08 } } } : undefined}
    >
      <CascadeItem cascade={cascade}>
        <div className={cn("flex h-16 items-center gap-2 pl-5 pr-3", collapsed && "h-auto flex-col gap-2 px-0 py-3")}>
          <Link href="/account" onClick={onNavigate} className={cn("flex min-w-0 flex-1 items-center gap-2.5", collapsed && "flex-none")} aria-label={collapsed ? "Your home" : undefined}>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary">
              <span className="text-sm font-black tracking-tight text-primary-foreground">{initials(siteName)}</span>
            </span>
            {!collapsed && <span className="truncate text-lg font-bold tracking-tight">{siteName}</span>}
          </Link>
          {collapseControl}
        </div>
      </CascadeItem>

      <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {NAV.map((item) => (
          <CascadeItem key={item.href} cascade={cascade}>
            <SidebarRow href={item.href} label={item.label} icon={item.icon} collapsed={collapsed} active={isActive(item)} indicatorId={indicatorId} onClick={onNavigate} />
          </CascadeItem>
        ))}
        <CascadeItem cascade={cascade}>
          {collapsed ? (
            <div aria-hidden="true" className="mx-auto my-3 h-px w-8 bg-border/70" />
          ) : (
            <p className="label-mono px-3 pb-1 pt-5 text-[11px] text-muted-foreground">/Help</p>
          )}
        </CascadeItem>
        {HELP_NAV.map((item) => (
          <CascadeItem key={item.href} cascade={cascade}>
            <SidebarRow href={item.href} label={item.label} icon={item.icon} collapsed={collapsed} active={isActive(item)} indicatorId={indicatorId} onClick={onNavigate} />
          </CascadeItem>
        ))}
      </nav>

      <div className="space-y-1 border-t border-border/60 px-3 py-3">
        <CascadeItem cascade={cascade}>
          <div className={cn("flex items-center gap-3 rounded-xl px-2 py-2", collapsed && "flex-col gap-2 px-0")}>
            <Link
              href="/account/profile"
              onClick={onNavigate}
              aria-label={collapsed ? "Your profile" : undefined}
              className={cn("group flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", collapsed && "flex-none")}
            >
              <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary ring-primary/40 transition group-hover:ring-2">
                {initials(customer.name)}
              </span>
              {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium group-hover:text-primary">{customer.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{customer.username ? `@${customer.username}` : customer.email}</span>
                </span>
              )}
            </Link>
            <ThemeToggle />
          </div>
        </CascadeItem>
        <CascadeItem cascade={cascade}>
          <SidebarRow label="Sign out" icon={LogOut} collapsed={collapsed} tone="destructive" onClick={onSignOut} />
        </CascadeItem>
      </div>
    </motion.div>
  )
}

export function CustomerShell({
  customer,
  siteName,
  initialCollapsed,
  children,
}: {
  customer: Customer
  siteName: string
  initialCollapsed: boolean
  children: ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const reduce = useReducedMotionSafe()
  const spring = useSpring()
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; SameSite=Lax`
  }

  // Ctrl/⌘+B toggles the desktop sidebar, matching the admin sidebar shortcut.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "b" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        document.getElementById("customer-sidebar-toggle")?.click()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Close the drawer when the route changes (state adjusted during render, as in the navbar).
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (pathname !== prevPathname) {
    setPrevPathname(pathname)
    setDrawerOpen(false)
  }

  const signOut = async () => {
    await api.post("/api/auth/customer/logout").catch(() => null)
    setDrawerOpen(false)
    router.push("/")
    router.refresh()
  }

  return (
    <div className="flex min-h-svh">
      {/* Desktop: floating glass sidebar. Width springs between states; the content column reflows with it. */}
      <motion.aside
        id="customer-sidebar"
        className="glass sticky top-3 z-40 m-3 mr-0 hidden h-[calc(100svh-1.5rem)] shrink-0 overflow-hidden rounded-2xl md:block"
        // Width must be in `initial`: Motion only server-renders initial values, so without it
        // the first paint has no width and the sidebar jumps once hydrated.
        initial={reduce ? false : { x: -28, opacity: 0, width: initialCollapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
        animate={{ x: 0, opacity: 1, width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
        transition={{ ...spring, opacity: { duration: DURATION.base, ease: EASE_OUT } }}
      >
        <SidebarBody
          customer={customer}
          siteName={siteName}
          collapsed={collapsed}
          indicatorId="customer-sidebar-active"
          onSignOut={signOut}
          collapseControl={<CollapseToggle collapsed={collapsed} onToggle={toggleCollapsed} />}
        />
      </motion.aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile: slim glass bar; the menu opens the same links in a drawer. */}
        <header className="glass-bar sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border px-3 md:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            className="grid size-10 place-items-center rounded-lg text-foreground hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Menu className="size-5" />
          </button>
          <Link href="/account" className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary">
              <span className="text-xs font-black tracking-tight text-primary-foreground">{initials(siteName)}</span>
            </span>
            <span className="font-bold tracking-tight">{siteName}</span>
          </Link>
          <ThemeToggle />
        </header>

        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left" variant="glass" className="inset-y-2 left-2 h-auto w-[86%] max-w-xs gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-xs">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SheetDescription className="sr-only">Site navigation and account</SheetDescription>
            <SidebarBody
              customer={customer}
              siteName={siteName}
              collapsed={false}
              indicatorId="customer-drawer-active"
              stagger
              onNavigate={() => setDrawerOpen(false)}
              onSignOut={signOut}
            />
          </SheetContent>
        </Sheet>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}
