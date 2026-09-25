"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/lib/api-client"

/**
 * Disabled until every required step is done — and the server refuses anyway,
 * because a disabled button is a courtesy, not a control.
 */
export function LaunchArenaButton({ canLaunch }: { canLaunch: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const launch = async () => {
    setBusy(true)
    const res = await api.post<unknown>("/api/admin/onboarding/launch").catch((err: Error) => err)
    setBusy(false)
    if (res instanceof Error) {
      toast.error(res.message)
      return
    }
    toast.success("Your arena is live")
    router.refresh()
  }

  return (
    <Button onClick={launch} disabled={!canLaunch || busy} title={canLaunch ? undefined : "Finish the required steps first"}>
      {busy ? <Spinner className="size-3.5" /> : "Launch arena"}
    </Button>
  )
}
