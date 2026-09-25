"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { api, errorMessage } from "@/lib/api-client"

export interface ChoosableArena {
  arenaId: string
  arenaName: string
  arenaSlug: string
  roleName?: string
}

/**
 * The list an operator picks from when they have signed in without saying
 * which arena they meant — which is every sign-in on the platform's own
 * hostname, since there is no arena in the address to infer it from.
 *
 * Selecting one posts to the same endpoint the header switcher uses, so the
 * choice is validated against the caller's memberships server-side and
 * recorded the same way. These buttons used to be plain links to
 * `/admin?arena=<slug>`, a parameter nothing read — so choosing an arena
 * returned to this screen, forever.
 */
export function ArenaChooser({ arenas }: { arenas: ChoosableArena[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)

  const choose = async (arena: ChoosableArena) => {
    setBusyId(arena.arenaId)
    try {
      await api.post("/api/admin/arena/select", { arenaId: arena.arenaId })
      // `refresh()` alone would re-render this same screen from cached RSC
      // payload; the push lands on the dashboard with the new cookie in play.
      router.push("/admin")
      router.refresh()
    } catch (err) {
      toast.error(errorMessage(err))
      setBusyId(null)
    }
  }

  return (
    <ul className="mt-8 w-full space-y-2">
      {arenas.map((arena) => (
        <li key={arena.arenaId}>
          <Button
            variant="outline"
            className="h-auto w-full justify-between py-3"
            onClick={() => choose(arena)}
            disabled={busyId !== null}
          >
            <span className="min-w-0 text-left">
              <span className="block truncate font-medium">{arena.arenaName}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {arena.roleName ? `${arena.roleName} · ` : ""}
                {arena.arenaSlug}
              </span>
            </span>
            {busyId === arena.arenaId ? (
              <Spinner className="size-4 shrink-0" />
            ) : (
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
          </Button>
        </li>
      ))}
    </ul>
  )
}
