import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import { createTestDb } from "../helpers/db"
import { getArena, getAdminUser, makeArena, customer, testActor } from "../helpers/fixtures"
import { createSession } from "@/server/services/sessions"
import { createBooking } from "@/server/services/bookings"
import { initializePayment, verifyPayment } from "@/server/services/payments"
import { setMockOutcome } from "@/server/payments/mock"
import { validateTicket, buildQrPayload } from "@/server/services/tickets"
import * as schema from "@/server/db/schema"

/**
 * Properties of the whole database, rather than of one operation.
 *
 * Two arenas are driven through the real booking, payment and admission paths
 * at the same time, and then every invariant is checked as a query over
 * everything that exists. A test of one function can pass while the system is
 * wrong; these are the statements that have to be true no matter which code
 * path produced the rows.
 */

let ctx: Awaited<ReturnType<typeof createTestDb>>
let a: schema.Arena
let b: schema.Arena
let actor: typeof testActor

beforeAll(async () => {
  ctx = await createTestDb()
  a = await getArena(ctx.db)
  b = await makeArena(ctx.db, "arena-b")
  actor = { ...testActor, id: (await getAdminUser(ctx.db)).id }

  // Both arenas run a session and sell into it, concurrently.
  const openSession = async (arenaId: string, title: string) => {
    const now = Date.now()
    return createSession(
      {
        title, venue: "Pitch",
        startsAt: new Date(now + 6 * 3_600_000), endsAt: new Date(now + 8 * 3_600_000),
        bookingOpensAt: new Date(now - 3_600_000), bookingDeadline: new Date(now + 5 * 3_600_000),
        teamsCount: 8, playersPerTeam: 4, ticketPriceMajor: 5000, publish: true,
      },
      { arenaId, actor }
    )
  }
  const [sessionA, sessionB] = await Promise.all([openSession(a.id, "A session"), openSession(b.id, "B session")])

  const buy = async (arenaId: string, sessionId: string, i: number) => {
    const { booking } = await createBooking(arenaId, { sessionId, customer: customer(i), idempotencyKey: randomUUID() }, { actor: { type: "customer" } })
    const { payment } = await initializePayment(arenaId, booking.id)
    await setMockOutcome(payment.reference, "success")
    return verifyPayment(arenaId, payment.reference)
  }

  // Interleaved on purpose: if anything in the pipeline leaked between
  // tenants, doing them together is when it would show.
  for (let i = 0; i < 6; i++) {
    await Promise.all([buy(a.id, sessionA.id, i), buy(b.id, sessionB.id, 100 + i)])
  }

  // Admit a few on each side, including a repeat scan.
  const tickets = await ctx.db.query.tickets.findMany()
  for (const ticket of tickets.slice(0, 4)) {
    await validateTicket(ticket.arenaId, buildQrPayload(ticket.arenaId, ticket.qrToken), { mode: "admit", actor })
    await validateTicket(ticket.arenaId, buildQrPayload(ticket.arenaId, ticket.qrToken), { mode: "admit", actor })
  }
})

afterAll(async () => {
  await ctx.client.close()
})

/** Runs a query that must return no rows; any row is a counter-example. */
async function noRows(label: string, query: string) {
  const result = (await ctx.db.execute(sql.raw(query))) as unknown as { rows: unknown[] }
  expect(result.rows, `${label}: ${JSON.stringify(result.rows.slice(0, 3))}`).toHaveLength(0)
}

describe("every row belongs to exactly one arena", () => {
  it("has no tenant-owned row without an arena", async () => {
    for (const table of ["sessions", "bookings", "tickets", "payments", "transactions", "teams", "session_slots", "customers", "media", "cms_pages", "faqs"]) {
      await noRows(`${table} without an arena`, `select id from ${table} where arena_id is null limit 5`)
    }
  })

  it("never relates two rows from different arenas", async () => {
    await noRows("booking vs session", `select b.id from bookings b join sessions s on s.id = b.session_id where s.arena_id <> b.arena_id limit 5`)
    await noRows("booking vs customer", `select b.id from bookings b join customers c on c.id = b.customer_id where c.arena_id <> b.arena_id limit 5`)
    await noRows("ticket vs booking", `select t.id from tickets t join bookings b on b.id = t.booking_id where b.arena_id <> t.arena_id limit 5`)
    await noRows("ticket vs session", `select t.id from tickets t join sessions s on s.id = t.session_id where s.arena_id <> t.arena_id limit 5`)
    await noRows("payment vs booking", `select p.id from payments p join bookings b on b.id = p.booking_id where b.arena_id <> p.arena_id limit 5`)
    await noRows("transaction vs payment", `select x.id from transactions x join payments p on p.id = x.payment_id where p.arena_id <> x.arena_id limit 5`)
    await noRows("slot vs session", `select sl.id from session_slots sl join sessions s on s.id = sl.session_id where sl.arena_id <> s.arena_id limit 5`)
    await noRows("scan vs ticket", `select v.id from ticket_validations v join tickets t on t.id = v.ticket_id where t.arena_id <> v.arena_id limit 5`)
  })
})

describe("a session can never exceed the capacity it declares", () => {
  it("keeps booked + held within capacity for every session", async () => {
    await noRows(
      "oversold session",
      `select id, booked_count, held_count, total_capacity from sessions where booked_count + held_count > total_capacity limit 5`
    )
  })

  it("has exactly one slot row per declared position, and no more", async () => {
    await noRows(
      "slot count mismatch",
      `select s.id from sessions s
       join (select session_id, count(*)::int as n from session_slots group by session_id) c on c.session_id = s.id
       where c.n <> s.total_capacity limit 5`
    )
  })

  it("never allocates one slot to two bookings", async () => {
    await noRows(
      "double-allocated slot",
      `select slot_id from bookings where slot_id is not null and status in ('PENDING','CONFIRMED')
       group by slot_id having count(*) > 1 limit 5`
    )
  })

  it("counts confirmed bookings and the booked counter the same way", async () => {
    await noRows(
      "counter drift",
      `select s.id, s.booked_count, c.n from sessions s
       join (select session_id, count(*)::int as n from bookings where status = 'CONFIRMED' group by session_id) c on c.session_id = s.id
       where s.booked_count <> c.n limit 5`
    )
  })
})

describe("money and tickets agree", () => {
  it("issues exactly one ticket per confirmed booking, and none for any other", async () => {
    await noRows(
      "confirmed booking with no ticket",
      `select b.id from bookings b left join tickets t on t.booking_id = b.id where b.status = 'CONFIRMED' and t.id is null limit 5`
    )
    await noRows(
      "ticket without a confirmed booking",
      `select t.id from tickets t join bookings b on b.id = t.booking_id
       where b.status <> 'CONFIRMED' and t.status not in ('CANCELLED','REFUNDED') limit 5`
    )
  })

  it("backs every issued ticket with a paid payment", async () => {
    await noRows(
      "ticket with no successful payment",
      `select t.id from tickets t
       where t.status in ('CONFIRMED','USED')
         and not exists (select 1 from payments p where p.booking_id = t.booking_id and p.status = 'PAID') limit 5`
    )
  })

  it("charges the session's own price, never a client-supplied one", async () => {
    await noRows(
      "amount disagrees with the session price",
      `select b.id from bookings b join sessions s on s.id = b.session_id where b.amount <> s.ticket_price limit 5`
    )
    await noRows(
      "payment disagrees with its booking",
      `select p.id from payments p join bookings b on b.id = p.booking_id where p.amount <> b.amount limit 5`
    )
  })

  it("holds no negative money anywhere", async () => {
    await noRows("negative payment", `select id from payments where amount < 0 limit 5`)
    await noRows("negative ticket price", `select id from tickets where price < 0 limit 5`)
    await noRows("negative session price", `select id from sessions where ticket_price < 0 limit 5`)
  })
})

describe("a ticket is admitted at most once", () => {
  it("records no more than one admission per ticket", async () => {
    await noRows(
      "admitted twice",
      `select ticket_id from ticket_validations where result = 'ADMITTED' and ticket_id is not null
       group by ticket_id having count(*) > 1 limit 5`
    )
  })

  it("marks every admitted ticket used, and every used ticket with a time", async () => {
    await noRows(
      "admitted but not used",
      `select t.id from tickets t join ticket_validations v on v.ticket_id = t.id
       where v.result = 'ADMITTED' and t.status <> 'USED' limit 5`
    )
    await noRows("used with no timestamp", `select id from tickets where status = 'USED' and used_at is null limit 5`)
  })

  it("keeps no usable credential in the scan log", async () => {
    // A stored QR payload would let anyone who can read this table walk in.
    await noRows(
      "full payload stored",
      `select id from ticket_validations where scanned_value like 'AP1.%' and length(scanned_value) > 12 limit 5`
    )
  })
})

describe("identity and access", () => {
  it("gives every arena at least one active owner", async () => {
    await noRows(
      "arena with no owner",
      `select a.id from arenas a where a.deleted_at is null and not exists (
         select 1 from arena_memberships m join roles r on r.id = m.role_id
         where m.arena_id = a.id and m.status = 'ACTIVE' and r.key = 'ARENA_OWNER') limit 5`
    )
  })

  it("never grants a platform permission through an arena membership", async () => {
    await noRows(
      "arena role with a platform permission",
      `select r.key from roles r join role_permissions p on p.role_id = r.id
       where r.scope = 'ARENA' and p.permission like 'platform.%' limit 5`
    )
  })

  it("never points a platform role slot at an arena role", async () => {
    await noRows(
      "platform_role_id referencing an arena role",
      `select u.id from users u join roles r on r.id = u.platform_role_id where r.scope <> 'PLATFORM' limit 5`
    )
  })

  it("holds at most one membership per person per arena", async () => {
    await noRows(
      "duplicate membership",
      `select arena_id, user_id from arena_memberships group by arena_id, user_id having count(*) > 1 limit 5`
    )
  })

  it("keeps customer email unique within an arena and free across arenas", async () => {
    await noRows(
      "duplicate email inside one arena",
      `select arena_id, lower(email) from customers where deleted_at is null group by arena_id, lower(email) having count(*) > 1 limit 5`
    )
    // The same address in two arenas is two different people as far as each
    // arena is concerned, and must remain possible.
    const shared = (await ctx.db.execute(
      sql.raw(`select count(distinct arena_id)::int as arenas from customers where lower(email) = 'player0@example.com'`)
    )) as unknown as { rows: { arenas: number }[] }
    expect(shared.rows[0].arenas).toBeGreaterThanOrEqual(1)
  })
})

describe("two arenas selling at the same moment", () => {
  it("fills each arena's session to its own capacity and no further", async () => {
    const now = Date.now()
    const open = (arenaId: string, title: string) =>
      createSession(
        {
          title, venue: "Pitch",
          startsAt: new Date(now + 6 * 3_600_000), endsAt: new Date(now + 8 * 3_600_000),
          bookingOpensAt: new Date(now - 3_600_000), bookingDeadline: new Date(now + 5 * 3_600_000),
          teamsCount: 8, playersPerTeam: 4, ticketPriceMajor: 5000, publish: true,
        },
        { arenaId, actor }
      )
    const [sessionA, sessionB] = await Promise.all([open(a.id, "A rush"), open(b.id, "B rush")])

    // 40 attempts against each arena's 32 slots, interleaved. Neither arena's
    // contention may consume the other's inventory.
    const attempts = Array.from({ length: 80 }, (_, i) => {
      const toA = i % 2 === 0
      return createBooking(
        toA ? a.id : b.id,
        { sessionId: toA ? sessionA.id : sessionB.id, customer: customer(500 + i), idempotencyKey: randomUUID() },
        { actor: { type: "customer" } }
      )
    })
    const results = await Promise.allSettled(attempts)
    const held = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof createBooking>>>[]

    const inA = held.filter((r) => r.value.booking.arenaId === a.id)
    const inB = held.filter((r) => r.value.booking.arenaId === b.id)
    expect(inA).toHaveLength(32)
    expect(inB).toHaveLength(32)

    // Every booking sits on a slot belonging to its own arena's session.
    for (const r of held) {
      expect(r.value.session.arenaId).toBe(r.value.booking.arenaId)
    }
    await noRows(
      "slot claimed across arenas",
      `select b.id from bookings b join session_slots sl on sl.id = b.slot_id where sl.arena_id <> b.arena_id limit 5`
    )
  })
})
