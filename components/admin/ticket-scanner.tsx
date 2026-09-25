"use client"

import { useEffect, useRef, useState } from "react"
import { Camera, CameraOff, CheckCircle2, Keyboard, XCircle, AlertTriangle, RotateCcw } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { api, errorMessage } from "@/lib/api-client"
import { formatDateTime, formatTime } from "@/lib/format"
import { DURATION, EASE_OUT } from "@/lib/motion"
import { cn } from "@/lib/utils"
import type { PublicTicket } from "@/server/serializers"

type Outcome = { result: "VALID" | "ALREADY_USED" | "NOT_VALID" | "WRONG_SESSION"; ticket: PublicTicket; reason?: string } | { result: "INVALID" }

const STYLES = {
  VALID: { icon: CheckCircle2, title: "VALID TICKET", cls: "border-primary bg-primary/10 text-primary" },
  ALREADY_USED: { icon: RotateCcw, title: "TICKET ALREADY USED", cls: "border-warning bg-warning/10 text-warning" },
  NOT_VALID: { icon: XCircle, title: "TICKET NOT VALID", cls: "border-destructive bg-destructive/10 text-destructive" },
  WRONG_SESSION: { icon: AlertTriangle, title: "WRONG SESSION", cls: "border-warning bg-warning/10 text-warning" },
  INVALID: { icon: XCircle, title: "INVALID CODE", cls: "border-destructive bg-destructive/10 text-destructive" },
} as const

export function TicketScanner({ sessions }: { sessions: Array<{ id: string; label: string }> }) {
  const [sessionId, setSessionId] = useState<string>("any")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [scanCount, setScanCount] = useState(0)
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastScan = useRef<{ value: string; at: number }>({ value: "", at: 0 })

  const validate = async (value: string, mode: "check" | "admit") => {
    if (!value.trim()) return
    setBusy(true)
    try {
      const res = await api.post<Outcome>("/api/admin/tickets/validate", { code: value.trim(), mode, sessionId: sessionId === "any" ? undefined : sessionId })
      setOutcome(res.data)
      setScanCount((n) => n + 1)
      if (navigator.vibrate) navigator.vibrate(res.data.result === "VALID" ? 80 : [60, 40, 60])
    } catch (err) {
      setOutcome({ result: "INVALID" })
      setScanCount((n) => n + 1)
      console.error(errorMessage(err))
    } finally {
      setBusy(false)
      setCode("")
      inputRef.current?.focus()
    }
  }

  // Camera scanning via the native BarcodeDetector when the browser has it.
  useEffect(() => {
    if (!cameraOn) return
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    const start = async () => {
      const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector
      if (!Detector) {
        setCameraError("This browser cannot scan QR codes directly. Use a handheld scanner or type the ticket number.")
        setCameraOn(false)
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
      } catch {
        setCameraError("Camera access was denied.")
        setCameraOn(false)
        return
      }
      const video = videoRef.current!
      video.srcObject = stream
      await video.play()
      const detector = new Detector({ formats: ["qr_code"] })
      const tick = async () => {
        if (stopped) return
        try {
          const codes = await detector.detect(video)
          const hit = codes[0]?.rawValue
          if (hit && (hit !== lastScan.current.value || Date.now() - lastScan.current.at > 4000)) {
            lastScan.current = { value: hit, at: Date.now() }
            await validate(hit, "admit")
          }
        } catch {
          /* frame not ready */
        }
        raf = requestAnimationFrame(() => setTimeout(tick, 250))
      }
      tick()
    }
    start()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn, sessionId])

  const style = outcome ? STYLES[outcome.result] : null

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardContent className="space-y-5 py-6">
          <div className="space-y-2">
            <Label>Session</Label>
            <Select value={sessionId} onValueChange={setSessionId}>
              <SelectTrigger><SelectValue placeholder="Any session" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any session (no check)</SelectItem>
                {sessions.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Choose today&apos;s session to reject tickets for other dates.</p>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); void validate(code, "admit") }} className="space-y-2">
            <Label htmlFor="code" className="flex items-center gap-2"><Keyboard className="size-4" />Ticket number or scanned code</Label>
            <Input ref={inputRef} id="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="AP-2026-000124" autoFocus autoComplete="off" className="font-mono" />
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" disabled={busy || !code} onClick={() => validate(code, "check")}>Check only</Button>
              <Button type="submit" disabled={busy || !code}>{busy ? <Spinner className="size-4" /> : "Admit"}</Button>
            </div>
            <p className="text-xs text-muted-foreground">Handheld scanners type the code and press Enter, which admits directly.</p>
          </form>

          <div className="space-y-2">
            <Button type="button" variant={cameraOn ? "secondary" : "outline"} className="w-full" onClick={() => { setCameraError(null); setCameraOn((v) => !v) }}>
              {cameraOn ? <><CameraOff className="mr-2 size-4" />Stop camera</> : <><Camera className="mr-2 size-4" />Scan with camera</>}
            </Button>
            {cameraError && <p className="text-xs text-destructive">{cameraError}</p>}
            {cameraOn && <video ref={videoRef} className="aspect-square w-full rounded-lg bg-black object-cover" muted playsInline />}
          </div>
        </CardContent>
      </Card>

      <div>
        <AnimatePresence mode="wait">
          {!outcome ? (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex h-full min-h-72 items-center justify-center rounded-2xl border border-dashed border-border text-center text-sm text-muted-foreground">
              Scan or enter a ticket to see the result here.
            </motion.div>
          ) : (
            <motion.div key={`${outcome.result}-${scanCount}`} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: DURATION.base, ease: EASE_OUT }} className={cn("rounded-2xl border-2 p-6", style!.cls)}>
              <div className="flex items-center gap-3">
                {(() => { const Icon = style!.icon; return <Icon className="size-8" /> })()}
                <h2 className="text-2xl font-black tracking-tight">{style!.title}</h2>
              </div>
              {"ticket" in outcome ? (
                <dl className="mt-6 grid gap-x-6 gap-y-3 text-foreground sm:grid-cols-2">
                  <Row label="Ticket" value={<span className="font-mono">{outcome.ticket.ticketNumber}</span>} />
                  <Row label="Session" value={outcome.ticket.session.title} />
                  <Row label="Kick-off" value={formatDateTime(outcome.ticket.session.startsAt)} />
                  <Row label="Player" value={outcome.ticket.playerName} />
                  <Row label="Customer" value={outcome.ticket.customerName} />
                  <Row label="Team" value={outcome.ticket.team ? `${outcome.ticket.team.name} · Slot ${outcome.ticket.slotNumber}` : "—"} />
                  <Row label="Status" value={outcome.ticket.status} />
                  {outcome.ticket.usedAt && <Row label="Scanned" value={formatTime(outcome.ticket.usedAt)} />}
                  {"reason" in outcome && outcome.reason && <Row label="Reason" value={outcome.reason} />}
                </dl>
              ) : (
                <p className="mt-4 text-foreground">The code is not a recognised Game Slots ticket. Ask the customer to show the ticket from their email or account.</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
