import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { sql } from "drizzle-orm"
import * as schema from "@/server/db/schema"
import { rowsOf } from "@/server/db/client"
import { createTestDb } from "../helpers/db"
import { makeArena } from "../helpers/fixtures"
import { expectDbError } from "../helpers/errors"

let ctx: Awaited<ReturnType<typeof createTestDb>>

beforeAll(async () => {
  ctx = await createTestDb()
})
afterAll(async () => {
  await ctx.client.close()
})

function sessionValues(arenaId: string, overrides: Partial<schema.NewSession> = {}): schema.NewSession {
  const now = Date.now()
  return {
    arenaId,
    title: "Test",
    venue: "Pitch 1",
    startsAt: new Date(now + 3_600_000),
    endsAt: new Date(now + 7_200_000),
    bookingOpensAt: new Date(now - 60_000),
    bookingDeadline: new Date(now + 3_000_000),
    teamsCount: 8,
    playersPerTeam: 4,
    totalCapacity: 32,
    ticketPrice: 500_000,
    ...overrides,
  }
}

describe("database integrity constraints", () => {
  it("rejects a capacity that does not equal teams × players", async () => {
    const arena = await makeArena(ctx.db, "a1")
    await expectDbError(ctx.db.insert(schema.sessions).values(sessionValues(arena.id, { totalCapacity: 33 })), /sessions_capacity_matches/)
  })

  it("rejects more than 8 teams or more than 4 players per team", async () => {
    const arena = await makeArena(ctx.db, "a2")
    await expectDbError(ctx.db.insert(schema.sessions).values(sessionValues(arena.id, { teamsCount: 9, totalCapacity: 36 })), /sessions_teams_range/)
    await expectDbError(ctx.db.insert(schema.sessions).values(sessionValues(arena.id, { playersPerTeam: 5, totalCapacity: 40 })), /sessions_players_range/)
  })

  it("rejects booked + held counts above capacity at the database level", async () => {
    const arena = await makeArena(ctx.db, "a3")
    const [s] = await ctx.db.insert(schema.sessions).values(sessionValues(arena.id)).returning()
    await expectDbError(ctx.db.update(schema.sessions).set({ bookedCount: 33 }).where(sql`id = ${s.id}`), /sessions_not_oversold/)
    await expectDbError(ctx.db.update(schema.sessions).set({ bookedCount: 30, heldCount: 3 }).where(sql`id = ${s.id}`), /sessions_not_oversold/)
  })

  it("rejects two slots at the same team/slot position", async () => {
    const arena = await makeArena(ctx.db, "a4")
    const [s] = await ctx.db.insert(schema.sessions).values(sessionValues(arena.id)).returning()
    const [team] = await ctx.db.insert(schema.teams).values({ arenaId: arena.id, sessionId: s.id, teamNumber: 1, name: "Team 1" }).returning()
    await ctx.db.insert(schema.sessionSlots).values({ arenaId: arena.id, sessionId: s.id, teamId: team.id, teamNumber: 1, slotNumber: 1 })
    await expectDbError(ctx.db.insert(schema.sessionSlots).values({ arenaId: arena.id, sessionId: s.id, teamId: team.id, teamNumber: 1, slotNumber: 1 }), /session_slots_position_idx/)
  })

  it("has a ticket number sequence", async () => {
    const res = await ctx.db.execute(sql`select nextval('ticket_number_seq') as n`)
    expect(Number(rowsOf<{ n: string }>(res)[0].n)).toBeGreaterThan(0)
  })
})
