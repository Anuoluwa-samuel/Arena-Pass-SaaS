"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ToneBadge } from "@/components/shared/status-badge"
import { api } from "@/lib/api-client"

export interface PlatformArena {
  id: string
  slug: string
  name: string
  status: string
  organizationName: string
  members: number
  sessions: number
  launchedAt: string | null
}

const TONE: Record<string, "success" | "warning" | "danger" | "info"> = {
  ACTIVE: "success",
  PENDING_SETUP: "info",
  SUSPENDED: "warning",
  ARCHIVED: "danger",
}

/**
 * Suspending and impersonating both ask for a reason, because both end up in
 * the audit trail and "why" is the part nobody remembers a week later.
 */
export function PlatformArenasTable({
  arenas,
  canManage,
  canImpersonate,
}: {
  arenas: PlatformArena[]
  canManage: boolean
  canImpersonate: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [reason, setReason] = useState<Record<string, string>>({})

  const act = async (arena: PlatformArena, run: () => Promise<unknown>, success: string) => {
    setBusy(arena.id)
    const res = await run().catch((err: Error) => err)
    setBusy(null)
    if (res instanceof Error) {
      toast.error(res.message)
      return
    }
    toast.success(success)
    router.refresh()
  }

  if (arenas.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No arenas yet.</p>
  }

  return (
    <ul className="space-y-3">
      {arenas.map((arena) => (
        <li key={arena.id}>
          <Card variant="glass">
            <CardContent className="flex flex-wrap items-center gap-4 p-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{arena.name}</span>
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">{arena.slug}</span>
                  <ToneBadge tone={TONE[arena.status] ?? "info"}>{arena.status.toLowerCase().replace("_", " ")}</ToneBadge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {arena.organizationName} · {arena.members} staff · {arena.sessions} sessions
                </p>
              </div>

              {(canManage || canImpersonate) && (
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                  <Input
                    aria-label={`Reason for acting on ${arena.name}`}
                    placeholder="Reason (recorded)"
                    value={reason[arena.id] ?? ""}
                    onChange={(e) => setReason((r) => ({ ...r, [arena.id]: e.target.value }))}
                    className="sm:w-56"
                  />
                  {canImpersonate && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy === arena.id}
                      onClick={() =>
                        act(
                          arena,
                          () => api.post("/api/platform/impersonation", { arenaId: arena.id, reason: reason[arena.id] ?? "" }),
                          `Viewing ${arena.name}, read-only`
                        )
                      }
                    >
                      View inside
                    </Button>
                  )}
                  {canManage && arena.status !== "PENDING_SETUP" && (
                    <Button
                      variant={arena.status === "SUSPENDED" ? "default" : "outline"}
                      size="sm"
                      disabled={busy === arena.id}
                      onClick={() =>
                        act(
                          arena,
                          () =>
                            api.post(`/api/platform/arenas/${arena.id}/status`, {
                              status: arena.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED",
                              reason: reason[arena.id] ?? undefined,
                            }),
                          arena.status === "SUSPENDED" ? "Arena restored" : "Arena suspended"
                        )
                      }
                    >
                      {arena.status === "SUSPENDED" ? "Restore" : "Suspend"}
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  )
}
