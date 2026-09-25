"use client"

import { useRouter } from "next/navigation"
import { LogOut, User } from "lucide-react"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ThemeToggle } from "@/components/theme-toggle"
import { api } from "@/lib/api-client"
import { initials } from "@/lib/format"
import { ArenaSwitcher, type SwitchableArena } from "@/components/admin/arena-switcher"

/**
 * The arena sits at the top left on every admin screen. An operator who works
 * for two arenas must never have to guess which one they are changing — and
 * switching is how they move between them.
 */
export function AdminHeader({
  user,
  arena,
  arenas,
}: {
  user: { name: string; email: string; roleName: string }
  arena: SwitchableArena
  arenas: SwitchableArena[]
}) {
  const router = useRouter()
  const signOut = async () => {
    await api.post("/api/auth/logout").catch(() => null)
    router.push("/admin/login")
    router.refresh()
  }
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 glass-bar border-b border-border px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="h-5" />
      <ArenaSwitcher current={arena} arenas={arenas} />
      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 pl-1.5">
              <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{initials(user.name)}</span>
              <span className="hidden text-left sm:block">
                <span className="block text-sm leading-tight">{user.name}</span>
                <span className="block text-[11px] leading-tight text-muted-foreground">{user.roleName}</span>
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled><User className="mr-2 size-4" />{user.roleName}</DropdownMenuItem>
            <DropdownMenuItem onSelect={signOut} className="text-destructive focus:text-destructive"><LogOut className="mr-2 size-4" />Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
