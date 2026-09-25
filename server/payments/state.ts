import type { PaymentStatus } from "@/lib/domain/constants"
import { AppError } from "@/server/http/errors"

/**
 * The payment lifecycle, written down once.
 *
 * Statuses were compared as strings in a dozen places, which is how a refunded
 * payment ends up marked paid by a late webhook. Every change now goes through
 * `assertTransition`, so an impossible move is a rejected operation rather
 * than a silently corrupted record.
 */
const ALLOWED: Record<PaymentStatus, readonly PaymentStatus[]> = {
  // A fresh attempt can still go anywhere.
  PENDING: ["PENDING", "PAID", "FAILED"],
  // Money has arrived. The only way out is a refund; a later "failed" event
  // for the same reference is the provider retrying an older state, and must
  // not un-pay a customer who holds a ticket.
  PAID: ["PAID", "REFUNDED"],
  // Terminal, except that a provider may confirm a late success for an
  // attempt we had given up on.
  FAILED: ["FAILED", "PAID"],
  // Terminal.
  REFUNDED: ["REFUNDED"],
}

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return ALLOWED[from].includes(to)
}

/** True when the move is a no-op — the same status arriving twice. */
export function isRepeat(from: PaymentStatus, to: PaymentStatus): boolean {
  return from === to
}

export function assertTransition(from: PaymentStatus, to: PaymentStatus, context: string): void {
  if (canTransition(from, to)) return
  throw new AppError("CONFLICT", `A ${from.toLowerCase()} payment cannot become ${to.toLowerCase()} (${context})`)
}

/** Statuses from which no further money movement is expected. */
export function isSettled(status: PaymentStatus): boolean {
  return status === "PAID" || status === "FAILED" || status === "REFUNDED"
}
