import Link from "next/link"
import { initials } from "@/lib/format"

const LINKS = [
  { href: "/sessions", label: "Sessions" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
]

/**
 * The closing line for inner pages. The full SiteFooter is the landing page's
 * final beat — repeating that whole block at the end of every page breaks the
 * reading flow, so everywhere else ends on this single band instead.
 */
export function SiteFooterSlim({ siteName }: { siteName: string }) {
  return (
    <footer className="mt-12 border-t border-border max-sm:mt-8">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-6 max-sm:gap-3 max-sm:py-5 sm:flex-row sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary">
            <span className="text-[0.625rem] font-black text-primary-foreground">{initials(siteName)}</span>
          </div>
          <span className="label-mono text-muted-foreground">
            © {new Date().getFullYear()} {siteName}
          </span>
        </Link>
        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 max-sm:gap-x-5">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="label-mono text-muted-foreground transition-colors hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  )
}
