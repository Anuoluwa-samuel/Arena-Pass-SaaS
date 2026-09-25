import "server-only"
import type { schema } from "@/server/db"
import { env } from "@/server/env"
import { hmac } from "@/server/auth/tokens"
import { availableSlots, deriveSessionStatus, occupancyPercent } from "@/lib/domain/session-status"
import type { CreatedBooking } from "@/server/services/bookings"
import type { getBookingById } from "@/server/services/bookings"
import type { TicketDetail } from "@/server/services/tickets"

/**
 * Public-facing shapes. Internal counters, tokens and foreign keys stay on
 * the server; the client only ever sees what it needs to render.
 */
export type PublicSession = ReturnType<typeof toPublicSession>

export function toPublicSession(s: schema.Session & { effectiveStatus?: schema.Session["status"] }) {
  const status = s.effectiveStatus ?? deriveSessionStatus(s)
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    venue: s.venue,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    bookingOpensAt: s.bookingOpensAt.toISOString(),
    bookingDeadline: s.bookingDeadline.toISOString(),
    teamsCount: s.teamsCount,
    playersPerTeam: s.playersPerTeam,
    totalCapacity: s.totalCapacity,
    bookedCount: s.bookedCount,
    availableSlots: availableSlots(s),
    occupancyPercent: occupancyPercent(s),
    ticketPrice: s.ticketPrice,
    currency: s.currency,
    status,
  }
}

export type PublicTeam = ReturnType<typeof toPublicTeams>[number]

export function toPublicTeams(teams: Array<schema.Team & { slots: schema.SessionSlot[] }>) {
  return teams.map((t) => ({
    id: t.id,
    teamNumber: t.teamNumber,
    name: t.name,
    slots: t.slots.map((s) => ({ slotNumber: s.slotNumber, taken: s.status !== "FREE" })),
    freeSlots: t.slots.filter((s) => s.status === "FREE").length,
  }))
}

export function toPublicBooking(created: CreatedBooking) {
  return {
    id: created.booking.id,
    status: created.booking.status,
    expiresAt: created.booking.expiresAt.toISOString(),
    amount: created.booking.amount,
    currency: created.booking.currency,
    playerName: created.booking.playerName,
    team: created.slot.teamNumber,
    slot: created.slot.slotNumber,
    session: toPublicSession(created.session),
  }
}

export function toPublicBookingDetail(d: Awaited<ReturnType<typeof getBookingById>>) {
  return {
    id: d.booking.id,
    status: d.booking.status,
    expiresAt: d.booking.expiresAt.toISOString(),
    amount: d.booking.amount,
    currency: d.booking.currency,
    playerName: d.booking.playerName,
    team: d.slot?.teamNumber ?? null,
    slot: d.slot?.slotNumber ?? null,
    session: toPublicSession(d.session),
    customer: { name: d.customer.name, email: maskEmail(d.customer.email) },
    payment: d.payment ? { reference: d.payment.reference, status: d.payment.status, authorizationUrl: d.payment.status === "PENDING" ? d.payment.authorizationUrl : null } : null,
    ticket: d.ticket ? { ticketNumber: d.ticket.ticketNumber, status: d.ticket.status, accessKey: ticketAccessKey(d.ticket.ticketNumber) } : null,
  }
}

/** Signed, non-guessable key embedded in ticket links sent by email. */
export function ticketAccessKey(ticketNumber: string) {
  return hmac(env.QR_SECRET, `ticket-access:${ticketNumber}`).slice(0, 32)
}

export type PublicTicket = ReturnType<typeof toPublicTicket>

export function toPublicTicket(d: TicketDetail) {
  return {
    id: d.ticket.id,
    ticketNumber: d.ticket.ticketNumber,
    status: d.ticket.status,
    paymentStatus: d.ticket.paymentStatus,
    ticketType: d.ticket.ticketType,
    playerName: d.ticket.playerName,
    customerName: d.customer.name,
    price: d.ticket.price,
    currency: d.ticket.currency,
    purchasedAt: d.ticket.purchasedAt.toISOString(),
    usedAt: d.ticket.usedAt?.toISOString() ?? null,
    team: d.team ? { number: d.team.teamNumber, name: d.team.name } : null,
    slotNumber: d.slot?.slotNumber ?? null,
    arenaName: d.arena?.name ?? "Game Slots",
    session: { id: d.session.id, title: d.session.title, venue: d.session.venue, startsAt: d.session.startsAt.toISOString(), endsAt: d.session.endsAt.toISOString(), status: d.session.status },
    accessKey: ticketAccessKey(d.ticket.ticketNumber),
  }
}

function maskEmail(email: string) {
  const [user, domain] = email.split("@")
  if (!domain) return email
  return `${user.slice(0, 2)}${"*".repeat(Math.max(1, user.length - 2))}@${domain}`
}
