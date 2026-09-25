"use client"

import { Calendar, Clock, MapPin, Printer, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { TicketStatusBadge } from "@/components/shared/status-badge"
import { formatDate, formatMoney, formatTimeRange, initials } from "@/lib/format"
import type { PublicTicket } from "@/server/serializers"

export function DigitalTicket({ ticket, qrImage }: { ticket: PublicTicket; qrImage: string }) {
  const inactive = ticket.status !== "CONFIRMED"
  return (
    <div>
      <Card variant="glass" className="print-ticket overflow-hidden">
        <div className="bg-primary px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary-foreground/20">
                <span className="text-xs font-black text-primary-foreground">{initials(ticket.arenaName)}</span>
              </div>
              <span className="font-semibold text-primary-foreground">{ticket.arenaName}</span>
            </div>
            <span className="font-mono text-sm text-primary-foreground/90">{ticket.ticketNumber}</span>
          </div>
        </div>

        <CardContent className="space-y-6 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Player</p>
              <p className="text-lg font-semibold">{ticket.playerName}</p>
              {ticket.playerName !== ticket.customerName && <p className="text-xs text-muted-foreground">Booked by {ticket.customerName}</p>}
            </div>
            <TicketStatusBadge status={ticket.status} />
          </div>

          <Separator />

          <div className="space-y-3">
            <h3 className="font-semibold">{ticket.session.title}</h3>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex items-center gap-3"><Calendar className="size-4 text-muted-foreground" />{formatDate(ticket.session.startsAt)}</div>
              <div className="flex items-center gap-3"><Clock className="size-4 text-muted-foreground" />{formatTimeRange(ticket.session.startsAt, ticket.session.endsAt)}</div>
              <div className="flex items-center gap-3"><MapPin className="size-4 text-muted-foreground" />{ticket.session.venue}</div>
              {ticket.team && (
                <div className="flex items-center gap-3"><Users className="size-4 text-muted-foreground" />{ticket.team.name} · Player {ticket.slotNumber}</div>
              )}
            </div>
          </div>

          <Separator />

          <div className="flex flex-col items-center gap-3">
            <div className={inactive ? "relative" : undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrImage} alt={`QR code for ticket ${ticket.ticketNumber}`} width={200} height={200} className={"size-48 rounded-lg bg-white p-2" + (inactive ? " opacity-30 grayscale" : "")} />
              {inactive && (
                <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold uppercase tracking-wider text-destructive">{ticket.status === "USED" ? "Admitted" : ticket.status}</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{inactive ? (ticket.status === "USED" ? `Scanned at the arena` : "This ticket is no longer valid for entry") : "Show this QR code at the arena entrance"}</p>
          </div>
        </CardContent>

        <div className="border-t border-dashed border-border bg-secondary/30 px-6 py-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Amount paid</span>
            <span className="text-lg font-bold text-primary">{formatMoney(ticket.price, ticket.currency)}</span>
          </div>
        </div>
      </Card>
      <div className="print-hidden mt-4 flex justify-center">
        <Button variant="ghost" size="sm" onClick={() => window.print()}>
          <Printer className="mr-2 size-4" /> Print or save as PDF
        </Button>
      </div>
    </div>
  )
}
