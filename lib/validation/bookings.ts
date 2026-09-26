import { z } from "zod"

/**
 * Booking requires an account, so the schema carries no identity.
 *
 * It used to take the customer's name and email in the body, which meant
 * anyone could reserve a slot as any email address — and the arena would hold
 * a booking, and send a ticket, in a name nobody had proved. Who is booking now
 * comes from the signed-in session and nowhere else.
 */
export const createBookingSchema = z.object({
  sessionId: z.string().uuid(),
  /** Who is playing, when that is not the account holder. Not an identity. */
  playerName: z.string().trim().min(2).max(80).optional(),
  preferredTeamNumber: z.number().int().min(1).max(8).optional(),
  /** Client-generated UUID; resubmitting the same key returns the same booking. */
  idempotencyKey: z.string().min(8).max(120),
})
export type CreateBookingInput = z.infer<typeof createBookingSchema>

export const waitlistSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
})
