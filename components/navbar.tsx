"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { LogOut, Menu, Ticket, User, X } from "lucide-react"
import { Fragment, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { useReducedMotionSafe } from "@/hooks/use-mobile"
import { api } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { ArrowButton } from "@/components/ui/arrow-button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ThemeToggle } from "@/components/theme-toggle"
import { cn } from "@/lib/utils"
import { DURATION, EASE_OUT } from "@/lib/motion"
import { initials } from "@/lib/format"

/** Full-screen auth pages: no navbar, the card's logo links home. */
const AUTH_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password"]

interface NavbarProps {
  customer?: { name: string } | null
  siteName?: string
  /** The arena's own logo. Falls back to its initials rather than the platform's mark. */
  logoUrl?: string | null
}

export function Navbar({ customer = null, siteName = "Arena Pass", logoUrl = null }: NavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [hidden, setHidden] = useState(false)
  const lastY = useRef(0)
  const pathname = usePathname()
  const reduce = useReducedMotionSafe()
  const router = useRouter()
  const isLoggedIn = !!customer
  const userName = customer?.name.split(" ")[0] ?? "Player"

  // Signed-in customers get a focused nav (book, get help, reach us); My Tickets
  // and Sign Out live in the account menu. Home and About stay reachable via the
  // logo and direct links. Shared by the desktop links and the mobile menu.
  const navLinks = isLoggedIn
    ? [
        { href: "/sessions", label: "Sessions" },
        { href: "/faq", label: "FAQ" },
        { href: "/contact", label: "Contact" },
      ]
    : [
        { href: "/", label: "Home" },
        { href: "/sessions", label: "Sessions" },
        { href: "/about", label: "About" },
        { href: "/faq", label: "FAQ" },
        { href: "/contact", label: "Contact" },
      ]

  const signOut = async () => {
    await api.post("/api/auth/customer/logout").catch(() => null)
    setMobileMenuOpen(false)
    router.push("/")
    router.refresh()
  }

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href))

  // Float slightly tighter once scrolled; tuck away while scrolling down, return on any scroll up.
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      setScrolled(y > 8)
      setHidden(y > 240 && y > lastY.current + 4)
      if (y < lastY.current - 4 || y <= 240) setHidden(false)
      lastY.current = y
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  // Close the mobile menu on route change so it never persists across navigation
  // (state adjusted during render, per React's "storing previous props" pattern).
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (pathname !== prevPathname) {
    setPrevPathname(pathname)
    setMobileMenuOpen(false)
  }

  const tucked = hidden && !mobileMenuOpen && !reduce

  if (AUTH_PATHS.includes(pathname)) return null

  return (
    <header
      className={cn(
        "sticky top-0 z-50 px-3 pt-3 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] sm:px-6",
        tucked && "-translate-y-[120%]"
      )}
    >
      <div
        className={cn(
          "glass mx-auto max-w-7xl rounded-2xl transition-[box-shadow,background-color] duration-500",
          scrolled && "shadow-[0_18px_50px_-20px_oklch(0_0_0/0.45)]"
        )}
      >
        <nav className="flex h-16 items-center justify-between px-4 sm:px-5">
          {/* Logo */}
          <Link href="/" className="group flex items-center gap-2.5">
            <motion.div
              whileHover={reduce ? undefined : { rotate: -8, scale: 1.06 }}
              transition={{ type: "spring", stiffness: 400, damping: 15 }}
              className={
                logoUrl
                  ? "flex size-9 items-center justify-center overflow-hidden rounded-lg"
                  : "flex size-9 items-center justify-center rounded-lg bg-primary shadow-[0_0_24px_-6px_var(--primary)]"
              }
            >
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- tenant logos are arbitrary uploaded URLs, not build-time assets
                <img src={logoUrl} alt="" className="size-full object-contain" />
              ) : (
                <span className="text-sm font-black tracking-tight text-primary-foreground">{initials(siteName)}</span>
              )}
            </motion.div>
            <span className="text-lg font-semibold tracking-tight">{siteName}</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden items-center md:flex">
            {navLinks.map((link, i) => (
              <Fragment key={link.href}>
                {i > 0 && <span aria-hidden="true" className="mx-1.5 size-1 rounded-full bg-muted-foreground/40" />}
                <Link
                  href={link.href}
                  aria-current={isActive(link.href) ? "page" : undefined}
                  className={cn(
                    "label-mono relative rounded-lg px-3.5 py-2 transition-colors duration-300",
                    isActive(link.href) ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {isActive(link.href) &&
                    (reduce ? (
                      <span className="absolute inset-0 -z-10 rounded-lg bg-foreground/[0.07]" />
                    ) : (
                      <motion.span
                        layoutId="navbar-active-pill"
                        className="absolute inset-0 -z-10 rounded-lg bg-foreground/[0.07] ring-1 ring-primary/25"
                        transition={{ type: "spring", stiffness: 380, damping: 32 }}
                      />
                    ))}
                  {link.label}
                </Link>
              </Fragment>
            ))}
          </div>

          {/* Desktop Auth */}
          <div className="hidden items-center gap-2 md:flex">
            <ThemeToggle className="mr-1" />
            {isLoggedIn ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="gap-2">
                    <div className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-primary">
                      <User className="size-4" />
                    </div>
                    <span>{userName}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem asChild>
                    <Link href="/account/tickets">
                      <Ticket className="mr-2 size-4" />
                      My Tickets
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={signOut} className="text-destructive focus:text-destructive">
                    <LogOut className="mr-2 size-4" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <Link href="/login" className="label-mono rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:text-foreground">
                  Sign In
                </Link>
                <ArrowButton asChild variant="primary" size="sm">
                  <Link href="/signup">Sign Up</Link>
                </ArrowButton>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <div className="flex items-center gap-1 md:hidden">
            <ThemeToggle />
            <button
              className="-mr-1.5 grid place-items-center rounded-lg p-2.5 transition-colors hover:bg-foreground/[0.06]"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
              aria-expanded={mobileMenuOpen}
            >
              <span className="relative block size-6">
                <AnimatePresence initial={false} mode="wait">
                  {mobileMenuOpen ? (
                    <motion.span
                      key="close"
                      className="absolute inset-0 grid place-items-center"
                      initial={reduce ? false : { opacity: 0, rotate: -90 }}
                      animate={{ opacity: 1, rotate: 0 }}
                      exit={reduce ? undefined : { opacity: 0, rotate: 90 }}
                      transition={{ duration: DURATION.fast, ease: EASE_OUT }}
                    >
                      <X className="size-6" />
                    </motion.span>
                  ) : (
                    <motion.span
                      key="menu"
                      className="absolute inset-0 grid place-items-center"
                      initial={reduce ? false : { opacity: 0, rotate: 90 }}
                      animate={{ opacity: 1, rotate: 0 }}
                      exit={reduce ? undefined : { opacity: 0, rotate: -90 }}
                      transition={{ duration: DURATION.fast, ease: EASE_OUT }}
                    >
                      <Menu className="size-6" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            </button>
          </div>
        </nav>

        {/* Mobile Menu */}
        <AnimatePresence initial={false}>
          {mobileMenuOpen && (
            <motion.div
              key="mobile-menu"
              initial={reduce ? false : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={reduce ? undefined : { height: 0, opacity: 0 }}
              transition={{ duration: DURATION.base, ease: EASE_OUT }}
              className="overflow-hidden md:hidden"
            >
              <motion.div
                className="space-y-1 border-t border-border px-3 py-4"
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.08 } } }}
              >
                {navLinks.map((link) => (
                  <motion.div
                    key={link.href}
                    variants={reduce ? undefined : { hidden: { opacity: 0, x: -12 }, show: { opacity: 1, x: 0, transition: { duration: DURATION.base, ease: EASE_OUT } } }}
                  >
                    <Link
                      href={link.href}
                      className={cn(
                        "label-mono flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors",
                        isActive(link.href) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
                      )}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      {link.label}
                    </Link>
                  </motion.div>
                ))}
                <div className="my-2 border-t border-border" />
                {isLoggedIn ? (
                  <>
                    <Link
                      href="/account/tickets"
                      className="label-mono block rounded-lg px-3 py-2.5 text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      My Tickets
                    </Link>
                    <button
                      type="button"
                      className="label-mono block w-full rounded-lg px-3 py-2.5 text-left text-destructive hover:bg-foreground/[0.05]"
                      onClick={signOut}
                    >
                      Sign Out
                    </button>
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-2 px-1 pt-1">
                    <Button variant="outline" asChild className="h-10 w-full font-mono text-xs uppercase tracking-[0.14em]">
                      <Link href="/login">Sign In</Link>
                    </Button>
                    <Button asChild className="h-10 w-full font-mono text-xs uppercase tracking-[0.14em]">
                      <Link href="/signup">Sign Up</Link>
                    </Button>
                  </div>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  )
}
