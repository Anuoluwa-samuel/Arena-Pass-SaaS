import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { schema } from "@/server/db"
import { createTestDb } from "../helpers/db"
import { getArena, customer, makeOpenSession , bookAs} from "../helpers/fixtures"
import { createBooking, sweepExpiredHolds } from "@/server/services/bookings"
import { getSessionById } from "@/server/services/sessions"
import { toPublicSession } from "@/server/serializers"

let ctx: Awaited<ReturnType<typeof createTestDb>>
/** Every service call in this file is scoped to the seeded arena. */
let arena: Awaited<ReturnType<typeof getArena>>
beforeAll(async () => {
  ctx = await createTestDb()
  arena = await getArena(ctx.db)
})
afterAll(async () => {
  await ctx.client.close()
})

const expire = (bookingId: string) =>
  ctx.db.update(schema.bookings).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.bookings.id, bookingId))

describe("full status and held slots agree", () => {
  it("a live hold on the last slot reads Sold Out, not Open", async () => {
    const session = await makeOpenSession(ctx.db, { teamsCount: 1, playersPerTeam: 1 })
    await bookAs(arena.id, 900, { sessionId: session.id })

    const read = await getSessionById(arena.id, session.id)
    expect(read.effectiveStatus).toBe("FULL")
    const pub = toPublicSession(read)
    expect(pub.availableSlots).toBe(0)
    expect(pub.status).toBe("FULL") // card shows "Join waitlist", never "Book a slot"
  })

  it("an expired hold is released on read, so the session is Open again and bookable", async () => {
    const session = await makeOpenSession(ctx.db, { teamsCount: 1, playersPerTeam: 1 })
    const first = await bookAs(arena.id, 910, { sessionId: session.id })
    await expire(first.booking.id)

    // No cron, no sweep: the single-session read alone must free it.
    const read = await getSessionById(arena.id, session.id)
    expect(read.heldCount).toBe(0)
    expect(read.effectiveStatus).toBe("OPEN_FOR_BOOKING")
    expect(toPublicSession(read).availableSlots).toBe(1)

    const stored = (await ctx.db.query.bookings.findFirst({ where: eq(schema.bookings.id, first.booking.id) }))!
    expect(stored.status).toBe("EXPIRED")
    const slot = (await ctx.db.query.sessionSlots.findFirst({ where: eq(schema.sessionSlots.sessionId, session.id) }))!
    expect(slot.status).toBe("FREE")

    const second = await bookAs(arena.id, 911, { sessionId: session.id })
    expect(second.slot).toEqual({ teamNumber: 1, slotNumber: 1 })
  })

  it("does not release a hold that is still live", async () => {
    const session = await makeOpenSession(ctx.db, { teamsCount: 1, playersPerTeam: 2 })
    const live = await bookAs(arena.id, 920, { sessionId: session.id })
    const read = await getSessionById(arena.id, session.id)
    expect(read.heldCount).toBe(1)
    expect(read.effectiveStatus).toBe("OPEN_FOR_BOOKING")
    const stored = (await ctx.db.query.bookings.findFirst({ where: eq(schema.bookings.id, live.booking.id) }))!
    expect(stored.status).toBe("PENDING")
  })

  it("the list sweep frees expired holds across sessions", async () => {
    const session = await makeOpenSession(ctx.db, { teamsCount: 1, playersPerTeam: 1 })
    const hold = await bookAs(arena.id, 930, { sessionId: session.id })
    await expire(hold.booking.id)

    await sweepExpiredHolds(0)
    const row = (await ctx.db.query.sessions.findFirst({ where: eq(schema.sessions.id, session.id) }))!
    expect(row.heldCount).toBe(0)
  })
})
