"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Eye } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api-client"

/**
 * Impossible to miss, and always on screen while it lasts.
 *
 * An operator who forgets they are inside somebody else's arena is how a
 * support session turns into an incident, so this sits above every admin page
 * and states the arena, the read-only limit and when it ends.
 */
export function ImpersonationBanner({ arenaName, expiresAt }: { arenaName: string; expiresAt: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  // The clock is read in an effect, not during render: render must be pure,
  // and a banner whose whole point is "this ends soon" should count down
  // rather than freeze at whatever the first paint happened to see.
  const [minutes, setMinutes] = useState<number | null>(null)

  useEffect(() => {
    const deadline = new Date(expiresAt).getTime()
    const tick = () => setMinutes(Math.max(0, Math.round((deadline - Date.now()) / 60_000)))
    tick()
    const timer = setInterval(tick, 30_000)
    return () => clearInterval(timer)
  }, [expiresAt])

  const stop = async () => {
    setBusy(true)
    const res = await api.delete("/api/platform/impersonation").catch((err: Error) => err)
    setBusy(false)
    if (res instanceof Error) {
      toast.error(res.message)
      return
    }
    router.push("/platform/arenas")
    router.refresh()
  }

  return (
    <div role="status" className="flex flex-wrap items-center gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm">
      <Eye className="size-4 shrink-0 text-amber-500" aria-hidden />
      <span className="min-w-0 flex-1">
        You are viewing <strong>{arenaName}</strong> as platform support. Read-only
        {minutes === null ? "" : `, and it ends in ${minutes} minute${minutes === 1 ? "" : "s"}`}.
      </span>
      <Button size="sm" variant="outline" onClick={stop} disabled={busy}>
        Stop viewing
      </Button>
    </div>
  )
}
