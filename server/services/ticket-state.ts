import type { TicketStatus } from "@/lib/domain/constants"
import { AppError } from "@/server/http/errors"

/**
 * The ticket lifecycle, written down once.
 *
 * The gate and the refund desk both change a ticket's status, from different
 * directions and sometimes at the same moment. Naming the legal moves keeps a
 * refunded ticket from being admitted and an admitted ticket from quietly
 * reverting to unused.
 */
const ALLOWED: Record<TicketStatus, readonly TicketStatus[]> = {
  // Issued but not yet paid for — only the payment path moves it on.
  PENDING: ["PENDING", "CONFIRMED", "CANCELLED", "EXPIRED"],
  // The normal live ticket.
  CONFIRMED: ["CONFIRMED", "USED", "CANCELLED", "REFUNDED", "EXPIRED"],
  // Admitted. Still refundable as a goodwill gesture, but never un-admitted:
  // the person is already inside.
  USED: ["USED", "REFUNDED"],
  CANCELLED: ["CANCELLED", "REFUNDED"],
  REFUNDED: ["REFUNDED"],
  EXPIRED: ["EXPIRED"],
}

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return ALLOWED[from].includes(to)
}

export function assertTransition(from: TicketStatus, to: TicketStatus, context: string): void {
  if (canTransition(from, to)) return
  throw new AppError("CONFLICT", `A ${from.toLowerCase()} ticket cannot become ${to.toLowerCase()} (${context})`)
}

/** Only a confirmed ticket can be admitted. */
export function isAdmissible(status: TicketStatus): boolean {
  return status === "CONFIRMED"
}
