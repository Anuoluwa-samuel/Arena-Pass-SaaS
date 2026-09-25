import Link from "next/link"
import { redirect } from "next/navigation"
import { Building2, LayoutDashboard, ShieldAlert } from "lucide-react"
import { getCurrentUser } from "@/server/auth/session"

export const dynamic = "force-dynamic"
export const metadata = { title: { default: "Platform", template: "%s · Arena Pass Platform" } }

/**
 * The platform control centre.
 *
 * Deliberately a separate shell from the arena dashboard, with its own
 * colouring and its own navigation, so an operator always knows which side of
 * the line they are standing on. Nothing here is scoped to an arena, and
 * nothing here can read one — reaching inside a tenant requires impersonation,
 * which is audited and read-only.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect("/admin/login?next=/platform")
  if (!user.platform) redirect("/admin")

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-amber-500/30 bg-amber-500/10 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <span className="flex items-center gap-2 font-semibold">
            <ShieldAlert className="size-4 text-amber-500" />
            Platform
          </span>
          <nav className="flex items-center gap-1 text-sm">
            <Link href="/platform" className="rounded px-2 py-1 hover:bg-secondary">
              <LayoutDashboard className="mr-1 inline size-3.5" />
              Overview
            </Link>
            <Link href="/platform/arenas" className="rounded px-2 py-1 hover:bg-secondary">
              <Building2 className="mr-1 inline size-3.5" />
              Arenas
            </Link>
          </nav>
          <span className="ml-auto text-xs text-muted-foreground">
            {user.name} · {user.platform.roleName}
          </span>
          <Link href="/admin" className="text-xs underline underline-offset-4">
            Leave platform
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
