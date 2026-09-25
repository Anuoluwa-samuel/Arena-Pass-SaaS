"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api-client"

/**
 * Signing out is a POST — it ends a session, which is not something a link
 * should do, and the route enforces same-origin. The refused-access screen
 * used to offer it as a plain `<Link>`, which fetched a 405 and left the
 * operator signed in on a screen whose whole purpose is getting them unstuck.
 */
export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const signOut = async () => {
    setBusy(true)
    // A failure here still ends the journey at sign-in: the session cookie is
    // cleared server-side or it is not, and either way the login page is the
    // right place to land.
    await api.post("/api/auth/logout").catch(() => null)
    router.push("/admin/login")
    router.refresh()
  }

  return (
    <Button variant="ghost" className={className} onClick={signOut} disabled={busy}>
      Sign out
    </Button>
  )
}
