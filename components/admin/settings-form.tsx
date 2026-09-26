"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import { api, errorMessage } from "@/lib/api-client"
import type { Settings } from "@/server/services/settings"

export function SettingsForm({ initial, canManage }: { initial: Settings; canManage: boolean }) {
  const router = useRouter()
  const [s, setS] = useState<Settings>(initial)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((cur) => ({ ...cur, [k]: v }))
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.patch("/api/admin/settings", s)
      toast.success("Settings saved")
      router.refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const dis = !canManage
  return (
    <form onSubmit={save} className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Site identity</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <F id="siteName" label="Site name"><Input id="siteName" value={s.siteName} onChange={(e) => set("siteName", e.target.value)} disabled={dis} /></F>
          <div className="grid grid-cols-2 gap-4 max-sm:items-end max-sm:gap-3">
            <F id="currency" label="Currency (ISO)"><Input id="currency" value={s.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} maxLength={3} disabled={dis} /></F>
            <F id="timezone" label="Timezone"><Input id="timezone" value={s.timezone} onChange={(e) => set("timezone", e.target.value)} disabled={dis} /></F>
          </div>
          <F id="supportEmail" label="Support email"><Input id="supportEmail" type="email" value={s.supportEmail} onChange={(e) => set("supportEmail", e.target.value)} disabled={dis} /></F>
          <F id="supportPhone" label="Support phone"><Input id="supportPhone" value={s.supportPhone} onChange={(e) => set("supportPhone", e.target.value)} disabled={dis} /></F>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Session defaults</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 max-sm:items-end max-sm:gap-3">
            <F id="defaultTeamsCount" label="Teams (max 8)"><Input id="defaultTeamsCount" type="number" min={1} max={8} value={s.defaultTeamsCount} onChange={(e) => set("defaultTeamsCount", Number(e.target.value))} disabled={dis} /></F>
            <F id="defaultPlayersPerTeam" label="Players per team (max 4)"><Input id="defaultPlayersPerTeam" type="number" min={1} max={4} value={s.defaultPlayersPerTeam} onChange={(e) => set("defaultPlayersPerTeam", Number(e.target.value))} disabled={dis} /></F>
          </div>
          <p className="text-xs text-muted-foreground">Default capacity: <span className="font-medium text-foreground">{s.defaultTeamsCount * s.defaultPlayersPerTeam} players</span>. Individual sessions can override within the limits.</p>
          <F id="defaultTicketPrice" label={`Default ticket price (${s.currency}, major units)`}><Input id="defaultTicketPrice" type="number" min={0} value={s.defaultTicketPrice / 100} onChange={(e) => set("defaultTicketPrice", Math.round(Number(e.target.value) * 100))} disabled={dis} /></F>
          <div className="grid grid-cols-2 gap-4 max-sm:items-end max-sm:gap-3">
            <F id="bookingHoldMinutes" label="Slot hold (minutes)"><Input id="bookingHoldMinutes" type="number" min={2} max={60} value={s.bookingHoldMinutes} onChange={(e) => set("bookingHoldMinutes", Number(e.target.value))} disabled={dis} /></F>
            <F id="sessionReminderHours" label="Reminder (hours before)"><Input id="sessionReminderHours" type="number" min={0} max={72} value={s.sessionReminderHours} onChange={(e) => set("sessionReminderHours", Number(e.target.value))} disabled={dis} /></F>
          </div>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Booking behaviour</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Toggle label="Maintenance mode" desc="Shows a notice on the public site and blocks new bookings." checked={s.maintenanceMode} onChange={(v) => set("maintenanceMode", v)} disabled={dis} />
        </CardContent>
      </Card>
      {canManage && <div className="lg:col-span-2"><Button type="submit" size="lg" disabled={busy}>{busy ? <Spinner className="size-4" /> : "Save settings"}</Button></div>}
    </form>
  )
}

function F({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>{children}</div>
}
function Toggle({ label, desc, checked, onChange, disabled }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
      <div><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted-foreground">{desc}</p></div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  )
}
