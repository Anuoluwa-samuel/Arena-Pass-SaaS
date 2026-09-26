import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "@/server/db/schema"
import {
  DEFAULT_PLAN_KEY,
  assertAdminWritable,
  assertWithinPlanLimit,
  currentUsage,
  getBillingSummary,
  getSubscription,
  listPlans,
  listSubscriptions,
  recordUsage,
  setSubscriptionPlan,
  startTrial,
} from "@/server/services/billing"
import { randomUUID } from "node:crypto"
import { createSession } from "@/server/services/sessions"
import { getPublicSessions } from "@/server/services/public-content"
import { createBooking } from "@/server/services/bookings"
import { initializePayment, verifyPayment } from "@/server/services/payments"
import { validateTicket, buildQrPayload } from "@/server/services/tickets"
import { setMockOutcome } from "@/server/payments/mock"
import { createStaff } from "@/server/services/users"
import { createTestDb } from "../helpers/db"
import { getArena, getAdminUser, testActor } from "../helpers/fixtures"

/**
 * Platform billing: what an organization is on, and what that lets it do.
 *
 * The line these guard is the one the whole feature rests on — a billing
 * failure is between the platform and the venue, and must never reach the
 * venue's customers.
 */

let ctx: Awaited<ReturnType<typeof createTestDb>>
let arena: schema.Arena
let organizationId: string
let actor: typeof testActor

/** Puts the organization on a named plan without going through the platform API. */
async function moveToPlan(key: string) {
  const plan = (await ctx.db.query.plans.findFirst({ where: eq(schema.plans.key, key) }))!
  await ctx.db
    .update(schema.subscriptions)
    .set({ planId: plan.id })
    .where(eq(schema.subscriptions.organizationId, organizationId))
  return plan
}

async function setStatus(status: schema.Subscription["status"], periodEnd?: Date) {
  await ctx.db
    .update(schema.subscriptions)
    .set({ status, ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}) })
    .where(eq(schema.subscriptions.organizationId, organizationId))
}

beforeAll(async () => {
  ctx = await createTestDb()
  arena = await getArena(ctx.db)
  organizationId = arena.organizationId!
  actor = { ...testActor, id: (await getAdminUser(ctx.db)).id }
})

afterAll(async () => {
  await ctx.client.close()
})

describe("the plan catalogue", () => {
  it("ships plans, and keeps the internal one out of the public list", async () => {
    const pub = await listPlans()
    const all = await listPlans({ includePrivate: true })
    expect(pub.length).toBeGreaterThan(0)
    expect(all.length).toBeGreaterThan(pub.length)
    // A venue must not be able to put itself on the comped plan.
    expect(pub.map((p) => p.key)).not.toContain("comped")
  })

  it("prices everything in integer minor units", async () => {
    for (const plan of await listPlans({ includePrivate: true })) {
      expect(Number.isInteger(plan.priceMinor), plan.key).toBe(true)
      expect(plan.priceMinor).toBeGreaterThanOrEqual(0)
    }
  })
})

describe("every organization has a subscription", () => {
  it("backfilled the organizations that predate billing", async () => {
    const subscription = await getSubscription(organizationId)
    expect(subscription).toBeTruthy()
    expect(subscription!.status).toBe("TRIALING")
  })

  it("records the trial in the append-only history", async () => {
    const subscription = await getSubscription(organizationId)
    const events = await ctx.db.query.subscriptionEvents.findMany({
      where: eq(schema.subscriptionEvents.subscriptionId, subscription!.id),
    })
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].toStatus).toBe("TRIALING")
  })

  it("refuses a second subscription for the same organization", async () => {
    // One live subscription per organization is a unique index, not a
    // convention — history belongs in subscription_events.
    await expect(startTrial(organizationId, ctx.db, { planKey: DEFAULT_PLAN_KEY })).rejects.toThrow()
  })
})

describe("the new permissions did not displace the old ones", () => {
  /**
   * Migration 0015 grants `billing.*` to ARENA_OWNER, and `baseline.ts` seeds a
   * role's defaults only when it has *no* permissions — otherwise it would
   * restore permissions an operator had deliberately revoked. On a fresh
   * install migrations run first, so granting billing in the migration
   * unconditionally left ARENA_OWNER holding two permissions and baseline
   * declining to add the rest: every arena owner locked out of their own arena.
   */
  it("leaves an arena owner holding the whole set, billing included", async () => {
    const role = (await ctx.db.query.roles.findFirst({ where: eq(schema.roles.key, "ARENA_OWNER") }))!
    const granted = (
      await ctx.db.query.rolePermissions.findMany({ where: eq(schema.rolePermissions.roleId, role.id) })
    ).map((r) => r.permission)

    for (const permission of ["sessions.manage", "tickets.validate", "staff.invite", "billing.view", "billing.manage"]) {
      expect(granted, permission).toContain(permission)
    }
  })

  it("does not give billing to an arena administrator", async () => {
    const role = (await ctx.db.query.roles.findFirst({ where: eq(schema.roles.key, "ARENA_ADMIN") }))!
    const granted = (
      await ctx.db.query.rolePermissions.findMany({ where: eq(schema.rolePermissions.roleId, role.id) })
    ).map((r) => r.permission)
    expect(granted).toContain("sessions.manage")
    expect(granted).not.toContain("billing.manage")
  })
})

describe("usage is counted across the organization, never across organizations", () => {
  it("counts this organization's arenas only", async () => {
    const [otherOrg] = await ctx.db
      .insert(schema.organizations)
      .values({ slug: "other-org", name: "Other Org", status: "ACTIVE" })
      .returning()
    await ctx.db
      .insert(schema.arenas)
      .values({ slug: "other-arena", name: "Other", organizationId: otherOrg.id, status: "ACTIVE", onboardingStep: "launched" })

    const mine = await currentUsage(organizationId, "ARENAS")
    const theirs = await currentUsage(otherOrg.id, "ARENAS")
    expect(mine).toBe(1)
    expect(theirs).toBe(1)
  })

  it("writes the ledger idempotently rather than doubling on a re-run", async () => {
    await recordUsage(organizationId, "TICKETS", 7)
    await recordUsage(organizationId, "TICKETS", 9)
    const rows = await ctx.db.query.usageRecords.findMany({
      where: eq(schema.usageRecords.organizationId, organizationId),
    })
    const tickets = rows.filter((r) => r.metric === "TICKETS")
    expect(tickets).toHaveLength(1)
    expect(tickets[0].quantity).toBe(9)
  })
})

describe("plan limits", () => {
  it("allows the operation while there is room", async () => {
    await moveToPlan("scale") // unlimited
    await expect(assertWithinPlanLimit({ arenaId: arena.id }, "STAFF")).resolves.toBeUndefined()
  })

  it("refuses once the plan's limit is reached, naming the plan", async () => {
    const plan = await moveToPlan("starter") // maxStaff 5
    const used = await currentUsage(organizationId, "STAFF")
    await ctx.db.update(schema.plans).set({ maxStaff: used }).where(eq(schema.plans.id, plan.id))

    await expect(assertWithinPlanLimit({ arenaId: arena.id }, "STAFF")).rejects.toMatchObject({
      code: "PLAN_LIMIT_REACHED",
    })
    await ctx.db.update(schema.plans).set({ maxStaff: 5 }).where(eq(schema.plans.id, plan.id))
  })

  it("stops a real staff invitation, not just the checker", async () => {
    const plan = await moveToPlan("starter")
    const used = await currentUsage(organizationId, "STAFF")
    await ctx.db.update(schema.plans).set({ maxStaff: used }).where(eq(schema.plans.id, plan.id))

    await expect(
      createStaff(
        { name: "One Too Many", email: "toomany@fixture.local", roleKey: "MANAGER", password: "a-strong-password", isActive: true },
        { arenaId: arena.id, actor, actorRoleKey: "ARENA_OWNER" }
      )
    ).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED" })

    await ctx.db.update(schema.plans).set({ maxStaff: 5 }).where(eq(schema.plans.id, plan.id))
  })

  it("treats a null limit as unlimited rather than as zero", async () => {
    await moveToPlan("scale")
    await expect(assertWithinPlanLimit({ arenaId: arena.id }, "SESSIONS")).resolves.toBeUndefined()
  })

  it("fails open when there is no subscription, rather than locking a venue out", async () => {
    const [orphanOrg] = await ctx.db
      .insert(schema.organizations)
      .values({ slug: "no-subscription", name: "No Subscription", status: "ACTIVE" })
      .returning()
    const [orphanArena] = await ctx.db
      .insert(schema.arenas)
      .values({ slug: "no-sub-arena", name: "No Sub", organizationId: orphanOrg.id, status: "ACTIVE", onboardingStep: "launched" })
      .returning()
    // Our bookkeeping problem, not theirs.
    await expect(assertWithinPlanLimit({ arenaId: orphanArena.id }, "STAFF")).resolves.toBeUndefined()
    await expect(assertAdminWritable(orphanArena.id)).resolves.toBeUndefined()
  })
})

describe("a lapsed subscription", () => {
  const longAgo = new Date(Date.now() - 60 * 86_400_000)

  afterEach(async () => {
    await setStatus("TRIALING", new Date(Date.now() + 30 * 86_400_000))
    await moveToPlan("scale")
  })

  it("still allows admin writes inside the grace period", async () => {
    await setStatus("PAST_DUE", new Date(Date.now() - 2 * 86_400_000))
    await expect(assertAdminWritable(arena.id)).resolves.toBeUndefined()
  })

  it("blocks admin writes once the grace period has run out", async () => {
    await setStatus("PAST_DUE", longAgo)
    await expect(assertAdminWritable(arena.id)).rejects.toMatchObject({ code: "SUBSCRIPTION_INACTIVE" })
  })

  it("blocks a real session from being created", async () => {
    await setStatus("EXPIRED", longAgo)
    const now = Date.now()
    await expect(
      createSession(
        {
          title: "Should not exist",
          venue: "Pitch A",
          startsAt: new Date(now + 6 * 3_600_000),
          endsAt: new Date(now + 8 * 3_600_000),
          bookingOpensAt: new Date(now - 3_600_000),
          bookingDeadline: new Date(now + 5 * 3_600_000),
          teamsCount: 2,
          playersPerTeam: 4,
          ticketPriceMajor: 5000,
          publish: true,
        },
        { arenaId: arena.id, actor }
      )
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_INACTIVE" })
  })
})

describe("a lapsed subscription never reaches the venue's customers", () => {
  /**
   * The promise the whole design rests on. A venue's card expiring is between
   * the venue and the platform; the person who has already paid for a slot is
   * not party to it, and must not find a dead storefront or a gate that will
   * not scan their ticket.
   */
  it("lets customers book, pay and be admitted while the organization is EXPIRED", async () => {
    // A session created while things are healthy, as one would already exist.
    await setStatus("TRIALING", new Date(Date.now() + 30 * 86_400_000))
    await moveToPlan("scale")
    const now = Date.now()
    const session = await createSession(
      {
        title: "Booked before the lapse",
        venue: "Pitch A",
        startsAt: new Date(now + 6 * 3_600_000),
        endsAt: new Date(now + 8 * 3_600_000),
        bookingOpensAt: new Date(now - 3_600_000),
        bookingDeadline: new Date(now + 5 * 3_600_000),
        teamsCount: 2,
        playersPerTeam: 4,
        ticketPriceMajor: 5000,
        publish: true,
      },
      { arenaId: arena.id, actor }
    )

    // Now the organization stops paying, well past any grace.
    await setStatus("EXPIRED", new Date(Date.now() - 60 * 86_400_000))
    await expect(assertAdminWritable(arena.id)).rejects.toMatchObject({ code: "SUBSCRIPTION_INACTIVE" })

    // The storefront still lists it.
    const publicSessions = await getPublicSessions(arena.id)
    expect(publicSessions.some((s) => s.id === session.id)).toBe(true)

    // A customer can still book.
    const { booking } = await createBooking(
      arena.id,
      { sessionId: session.id, customer: { name: "Paying Customer", email: "customer@fixture.local", phone: "+2348000000001" }, idempotencyKey: randomUUID() },
      { actor: { type: "customer" } }
    )
    expect(booking.status).toBe("PENDING")

    // And still pay.
    const { payment } = await initializePayment(arena.id, booking.id)
    await setMockOutcome(payment.reference, "success")
    const verified = await verifyPayment(arena.id, payment.reference)
    expect(verified.status).toBe("PAID")

    // And still be admitted at the gate.
    const issued = await ctx.db.query.tickets.findFirst({ where: eq(schema.tickets.bookingId, booking.id) })
    expect(issued, "a paid booking issues a ticket even while the venue owes us money").toBeTruthy()
    const outcome = await validateTicket(arena.id, buildQrPayload(arena.id, issued!.qrToken), {
      mode: "admit",
      actor,
    })
    expect(outcome.result).toBe("VALID")

    await setStatus("TRIALING", new Date(Date.now() + 30 * 86_400_000))
  })
})

describe("the platform view", () => {
  it("lists every organization with its plan", async () => {
    const rows = await listSubscriptions()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => typeof r.planName === "string")).toBe(true)
  })

  it("records a plan change twice — as history and as audit", async () => {
    await setSubscriptionPlan(organizationId, "growth", { actor, reason: "negotiated" })
    const subscription = await getSubscription(organizationId)
    const events = await ctx.db.query.subscriptionEvents.findMany({
      where: eq(schema.subscriptionEvents.subscriptionId, subscription!.id),
    })
    expect(events.some((e) => e.type === "plan_changed")).toBe(true)

    const audits = await ctx.db.query.auditLogs.findMany({
      where: eq(schema.auditLogs.action, "subscription.plan_change"),
    })
    expect(audits.length).toBeGreaterThan(0)
  })

  it("is a not-found for an organization that does not exist", async () => {
    await expect(getBillingSummary("00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
})
