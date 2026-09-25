"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronsUpDown } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { api } from "@/lib/api-client"

export interface SwitchableArena {
  arenaId: string
  arenaName: string
  arenaSlug: string
  roleName: string
}

/**
 * Shown only when this operator belongs to more than one arena, and listing
 * only those — the menu is built from their memberships, so an arena they
 * have no part in can never appear here. Choosing one is still validated
 * server-side; this only records a preference.
 */
export function ArenaSwitcher({ current, arenas }: { current: SwitchableArena; arenas: SwitchableArena[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  if (arenas.length < 2) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-semibold">{current.arenaName}</span>
        <span className="hidden rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground sm:inline">{current.arenaSlug}</span>
      </div>
    )
  }

  const choose = async (arena: SwitchableArena) => {
    if (arena.arenaId === current.arenaId) return
    setBusy(true)
    const res = await api.post<unknown>("/api/admin/arena/select", { arenaId: arena.arenaId }).catch((err: Error) => err)
    setBusy(false)
    if (res instanceof Error) {
      toast.error(res.message)
      return
    }
    toast.success(`Switched to ${arena.arenaName}`)
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="min-w-0 gap-1.5 px-2" disabled={busy} aria-label="Switch arena">
          <span className="truncate text-sm font-semibold">{current.arenaName}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Your arenas</DropdownMenuLabel>
        {arenas.map((arena) => (
          <DropdownMenuItem key={arena.arenaId} onSelect={() => choose(arena)} className="gap-2">
            <Check className={arena.arenaId === current.arenaId ? "size-4 shrink-0" : "size-4 shrink-0 opacity-0"} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{arena.arenaName}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{arena.roleName}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
