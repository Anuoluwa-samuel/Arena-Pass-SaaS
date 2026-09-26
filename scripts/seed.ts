/**
 * Development seed. Creates **two independent arenas** with their own owners,
 * staff, customers, sessions, bookings, tickets, branding and content, and
 * pushes real bookings through the real payment pipeline (mock provider) so
 * counters, slots, tickets and ledgers are all consistent.
 *
 * Two arenas rather than one on purpose: tenant isolation is not something you
 * can see in a database with a single tenant in it. One customer email is
 * deliberately shared between them, because "the same person plays at both"
 * is exactly the case that used to be impossible.
 *
 * Idempotent: skips if the marker session already exists. Never runs in
 * production.
 */
import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { db, schema } from "@/server/db"
import { getDefaultArena } from "@/server/services/arenas"
import { createSession, cancelSession } from "@/server/services/sessions"
import { createBooking } from "@/server/services/bookings"
import { upsertCustomerByEmail } from "@/server/services/customers"
import { initializePayment, verifyPayment } from "@/server/services/payments"
import { setMockOutcome } from "@/server/payments/mock"
import { validateTicket, buildQrPayload } from "@/server/services/tickets"
import { createFaq, createService, createAnnouncement, createBanner } from "@/server/services/cms"
import { createStaff } from "@/server/services/users"
import { registerArena, getOnboardingState, launchArena } from "@/server/services/onboarding"
import { setSubscriptionPlan } from "@/server/services/billing"
import { savePaymentAccount } from "@/server/payments/accounts"
import { updateSettings } from "@/server/services/settings"
import { SYSTEM_ACTOR, type AuditActor } from "@/server/services/audit"
import type { ArenaRoleKey } from "@/lib/domain/constants"

const H = 3_600_000
const NAMES = ["Ada Okafor", "Tunde Bakare", "Chiamaka Eze", "Emeka Obi", "Yusuf Bello", "Ngozi Umeh", "Seyi Adeyemi", "Kemi Alabi", "Ibrahim Musa", "Funke Ojo", "Tobi Lawal", "Amara Nwosu", "Dayo Fashola", "Zainab Sule", "Kunle Adebayo", "Ifeoma Chukwu", "Bola Ahmed", "Chidi Okeke", "Halima Yakubu", "Femi Oyelaran"]

interface ArenaPlan {
  arenaId: string
  label: string
  /** Distinguishes one arena's customers from the other's. */
  emailDomain: string
  staffDomain: string
  primaryPitch: string
  secondPitch: string
  priceMajor: number
  brand: { primary: string; accent: string }
  actor: AuditActor & { id: string }
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to seed a production database")
    process.exit(1)
  }

  const database = await db()
  const marker = await database.query.sessions.findFirst({ where: eq(schema.sessions.title, "Friday Night Football") })
  if (marker) {
    console.log("Seed data already present — nothing to do.")
    process.exit(0)
  }

  const now = Date.now()
  const at = (hoursFromNow: number, hour?: number) => {
    const d = new Date(now + hoursFromNow * H)
    if (hour !== undefined) d.setHours(hour, 0, 0, 0)
    return d
  }

  // ---------------------------------------------------------------------
  // Arena A — the arena the platform owner already operates. The baseline
  // names it after the platform, which was fine when the product *was* one
  // arena; as a tenant among others it needs a venue's name.
  // ---------------------------------------------------------------------
  const arenaA = await getDefaultArena()
  await database.update(schema.arenas).set({ name: "Ikeja City Arena" }).where(eq(schema.arenas.id, arenaA.id))
  // Ikeja's own owner, created by the baseline alongside — and separate from —
  // the platform owner. Everything this arena does is done as its own operator,
  // never as whoever runs Game Slots.
  const ikejaOwner = (await database.query.users.findFirst({
    where: eq(schema.users.email, `owner@${arenaA.slug}.local`),
  }))!

  // ---------------------------------------------------------------------
  // Arena B — registered the way a real tenant registers, through the same
  // service the public sign-up form calls.
  // ---------------------------------------------------------------------
  const registered = await registerArena({
    name: "Bola Owner",
    email: "owner@lekki.local",
    password: "ChangeMe123!",
    organizationName: "Lekki Sports Ltd",
    arenaName: "Lekki Football Arena",
    slug: "lekki",
    city: "Lagos",
  })

  const plans: ArenaPlan[] = [
    {
      arenaId: arenaA.id,
      label: "Ikeja City Arena",
      emailDomain: "example.com",
      staffDomain: "ikeja.local",
      primaryPitch: "Main Pitch",
      secondPitch: "Pitch B",
      priceMajor: 5000,
      brand: { primary: "#22c55e", accent: "#0ea5e9" },
      actor: { type: "user", id: ikejaOwner.id, name: ikejaOwner.name },
    },
    {
      arenaId: registered.arena.id,
      label: "Lekki Football Arena",
      emailDomain: "lekki.example.com",
      staffDomain: "lekki.local",
      primaryPitch: "Lekki Pitch 1",
      secondPitch: "Lekki Pitch 2",
      priceMajor: 7500,
      brand: { primary: "#f97316", accent: "#a855f7" },
      actor: { type: "user", id: registered.user.id, name: registered.user.name },
    },
  ]

  // The demo arenas carry more staff and sessions than the free tier covers,
  // and the seed exists to produce a full-looking product rather than to
  // demonstrate a limit being hit. Both go on the unlimited plan; move one to
  // Starter from Platform → Subscriptions to watch the limits bite.
  for (const organizationId of [arenaA.organizationId!, registered.organization.id]) {
    await setSubscriptionPlan(organizationId, "scale", { actor: SYSTEM_ACTOR, reason: "development seed" })
  }

  for (const plan of plans) await seedArena(plan)

  console.log("\nSeed complete — two arenas.")
  console.log("  Platform owner : admin@gameslots.local / ChangeMe123!  (platform only \u2014 no arena access)")
  console.log("  Ikeja owner    : owner@main.local / ChangeMe123!        (Ikeja City Arena only)")
  console.log("  Lekki owner    : owner@lekki.local / ChangeMe123!       (Lekki Football Arena only)")
  console.log("  Staff          : grace.admin@, musa.manager@, folake.finance@, sam.staff@, tola.ticketagent@")
  console.log("                   at @ikeja.local and @lekki.local respectively")
  console.log("  Shared customer: ada.shared@example.com plays at both arenas, with a separate account at each")
  console.log("\n  Reach them with  Host: main.localhost  and  Host: lekki.localhost")
  process.exit(0)

  // -------------------------------------------------------------------------

  async function seedArena(plan: ArenaPlan) {
    const { arenaId, actor } = plan
    console.log(`\nSeeding ${plan.label}…`)

    await updateSettings({ siteName: plan.label, defaultTicketPrice: plan.priceMajor * 100 }, { arenaId, updatedBy: actor.id })
    await database
      .update(schema.arenas)
      .set({ brandPrimaryColor: plan.brand.primary, brandAccentColor: plan.brand.accent })
      .where(eq(schema.arenas.id, arenaId))
    // Its own payment account, so neither arena falls back to the platform's.
    await savePaymentAccount(
      arenaId,
      { provider: "mock", status: "ACTIVE", secretKey: `sk_seed_${plan.arenaId.slice(0, 8)}`, publicKey: `pk_seed_${plan.arenaId.slice(0, 8)}` },
      { actor }
    )

    const seedSession = (input: Parameters<typeof createSession>[0]) => createSession(input, { arenaId, actor })

    /** Books and pays for `count` slots, as a customer would. */
    async function sell(sessionId: string, count: number, offset: number) {
      const tickets = []
      for (let i = 0; i < count; i++) {
        const n = offset + i
        // One address is shared between arenas on purpose: each arena gets its
        // own customer record for that person, and neither can see the other's.
        const shared = i === 0
        const customer = shared
          ? { name: "Ada Shared", email: "ada.shared@example.com", phone: "+2348000000000" }
          : {
              name: NAMES[n % NAMES.length] + (n >= NAMES.length ? ` ${Math.floor(n / NAMES.length) + 1}` : ""),
              email: `player${n}@${plan.emailDomain}`,
              phone: `+23480000${String(n).padStart(4, "0")}`,
            }
        // Booking requires an account, so the seed creates one first — the same
        // order a real customer goes through.
        const account = await upsertCustomerByEmail(arenaId, customer)
        const { booking } = await createBooking(
          arenaId,
          { sessionId, idempotencyKey: randomUUID() },
          { actor: { type: "customer", id: account.id, name: account.name }, customerId: account.id }
        )
        const { payment } = await initializePayment(arenaId, booking.id)
        await setMockOutcome(payment.reference, "success")
        const outcome = await verifyPayment(arenaId, payment.reference)
        if (outcome.status === "PAID") tickets.push(outcome.ticket)
      }
      return tickets
    }

    // 1. Open now, healthy sales
    const friday = await seedSession({ title: "Friday Night Football", venue: plan.primaryPitch, startsAt: at(30, 19), endsAt: at(30, 21), bookingOpensAt: at(-24), bookingDeadline: at(29), teamsCount: 8, playersPerTeam: 4, ticketPriceMajor: plan.priceMajor, publish: true, description: "Our flagship Friday session under the floodlights. Eight teams, four-a-side, rotating fixtures all evening." })
    await sell(friday.id, 21, 0)

    // 2. Open now, almost full
    const saturday = await seedSession({ title: "Saturday Morning Kick-Off", venue: plan.secondPitch, startsAt: at(54, 9), endsAt: at(54, 11), bookingOpensAt: at(-48), bookingDeadline: at(52), teamsCount: 8, playersPerTeam: 4, ticketPriceMajor: plan.priceMajor - 1000, publish: true, description: "Early kick-off for the early risers. Coffee at the clubhouse afterwards." })
    await sell(saturday.id, 30, 30)

    // 3. Sold out
    const sunday = await seedSession({ title: "Sunday League Showdown", venue: plan.primaryPitch, startsAt: at(78, 16), endsAt: at(78, 18), bookingOpensAt: at(-72), bookingDeadline: at(76), teamsCount: 8, playersPerTeam: 4, ticketPriceMajor: plan.priceMajor + 1000, publish: true })
    await sell(sunday.id, 32, 70)

    // 4. Booking opens later
    await seedSession({ title: "Midweek Six-Team Special", venue: plan.secondPitch, startsAt: at(120, 18), endsAt: at(120, 20), bookingOpensAt: at(48), bookingDeadline: at(118), teamsCount: 6, playersPerTeam: 4, ticketPriceMajor: plan.priceMajor - 1500, publish: true, description: "A shorter format with six teams — more minutes on the ball for everyone." })

    // 5. Completed, with attendance
    const past = await seedSession({ title: "Last Week's Friday Football", venue: plan.primaryPitch, startsAt: at(-150, 19), endsAt: at(-150, 21), bookingOpensAt: at(-300), bookingDeadline: at(-151), teamsCount: 8, playersPerTeam: 4, ticketPriceMajor: plan.priceMajor, publish: true })
    // Temporarily shift the window so the seed can book, then restore the real (past) times.
    await database.update(schema.sessions).set({ bookingOpensAt: at(-1), bookingDeadline: at(5), startsAt: at(6), endsAt: at(8) }).where(eq(schema.sessions.id, past.id))
    const pastTickets = await sell(past.id, 28, 110)
    for (const t of pastTickets.slice(0, 24)) {
      await validateTicket(arenaId, buildQrPayload(arenaId, t.qrToken), { mode: "admit", actor })
    }
    await database.update(schema.sessions).set({ startsAt: at(-150, 19), endsAt: at(-150, 21), bookingOpensAt: at(-300), bookingDeadline: at(-151), status: "COMPLETED" }).where(eq(schema.sessions.id, past.id))
    await database.update(schema.tickets).set({ purchasedAt: at(-170) }).where(eq(schema.tickets.sessionId, past.id))

    // 6. Draft and cancelled
    await seedSession({ title: "Corporate Cup Qualifier", venue: plan.primaryPitch, startsAt: at(200, 17), endsAt: at(200, 19), bookingOpensAt: at(100), bookingDeadline: at(198), teamsCount: 8, playersPerTeam: 4, ticketPriceMajor: plan.priceMajor + 2500, publish: false })
    const cancelled = await seedSession({ title: "Rained-Off Thursday", venue: plan.secondPitch, startsAt: at(10, 18), endsAt: at(10, 20), bookingOpensAt: at(-20), bookingDeadline: at(9), teamsCount: 8, playersPerTeam: 4, ticketPriceMajor: plan.priceMajor - 1000, publish: true })
    await cancelSession(arenaId, cancelled.id, "Pitch waterlogged after heavy rain", { actor })

    // Spread purchase dates so the dashboard chart has shape.
    const tickets = await database.query.tickets.findMany({ where: eq(schema.tickets.arenaId, arenaId) })
    for (const [i, t] of tickets.entries()) {
      if (t.sessionId === past.id) continue
      await database.update(schema.tickets).set({ purchasedAt: new Date(now - ((i * 7) % 14) * 86_400_000 - (i % 5) * H) }).where(eq(schema.tickets.id, t.id))
    }

    // Content
    for (const [q, a] of [
      ["How many players are in a session?", "Every standard session has 8 teams of 4 players — 32 players in total. Some special sessions use fewer teams; the session page always shows the exact structure."],
      ["What happens if a session sells out?", "You can join the waitlist from the session page. If a slot frees up we will email you straight away."],
      ["Can I get a refund?", "Refunds are issued automatically when a session is cancelled. For other cases contact us at least 24 hours before kick-off."],
      ["Do I need to print my ticket?", "No. Show the QR code on your digital ticket at the entrance and our staff will scan you in."],
      ["How are teams decided?", "Teams are assigned automatically as players book, keeping all teams balanced. You can pick a preferred team when you book if it still has space."],
    ]) {
      await createFaq(arenaId, { question: q, answer: a, isPublished: true }, { actor })
    }
    for (const s of [
      { title: "Organised 4-a-side sessions", description: "Balanced teams, rotating fixtures and a referee at every session.", icon: "trophy" },
      { title: "Floodlit all-weather pitch", description: "Play year-round on a FIFA-quality artificial surface.", icon: "sun" },
      { title: "Instant digital tickets", description: "Book in seconds, pay securely and get a QR ticket straight to your inbox.", icon: "ticket" },
      { title: "Changing rooms and showers", description: "Clean facilities so you can go straight from the pitch to your evening.", icon: "droplets" },
    ]) {
      await createService(arenaId, { ...s, isPublished: true }, { actor })
    }
    await createAnnouncement(arenaId, { title: `New Saturday mornings at ${plan.label}`, content: "By popular demand we now run a 9am Saturday session. Early-bird pricing applies for the first month.", status: "PUBLISHED", publishAt: at(-48), expiresAt: at(24 * 30) }, { actor })
    await createBanner(arenaId, { title: "Bring a friend, save ₦1,000", subtitle: "Book two slots in the same session and get a discount at the desk.", linkUrl: "/sessions", linkLabel: "Find a session", isActive: true }, { actor })

    // One account per arena role, so every permission level can be signed in as.
    const staff: Array<[ArenaRoleKey, string, string]> = [
      ["ARENA_ADMIN", "Grace Admin", `grace.admin@${plan.staffDomain}`],
      ["MANAGER", "Musa Manager", `musa.manager@${plan.staffDomain}`],
      ["FINANCE", "Folake Finance", `folake.finance@${plan.staffDomain}`],
      ["STAFF", "Sam Staff", `sam.staff@${plan.staffDomain}`],
      ["TICKET_AGENT", "Tola Agent", `tola.ticketagent@${plan.staffDomain}`],
    ]
    for (const [roleKey, name, email] of staff) {
      await createStaff({ name, email, roleKey, password: "ChangeMe123!", isActive: true }, { arenaId, actor: SYSTEM_ACTOR, actorRoleKey: "ARENA_OWNER" })
    }

    // A registered arena starts closed. Both are opened here so the seeded
    // database is browsable on both hostnames — through the same launch path
    // an owner uses, which also proves the checklist is satisfied.
    const state = await getOnboardingState(arenaId)
    if (!state.launched) {
      await launchArena(arenaId, { actor })
      console.log(`  launched ${plan.label}`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
