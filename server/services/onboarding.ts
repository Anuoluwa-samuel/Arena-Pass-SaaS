import "server-only"
import { and, eq, isNull, ne, sql } from "drizzle-orm"
import { z } from "zod"
import { db, schema } from "@/server/db"
import { AppError, isUniqueViolation, notFound } from "@/server/http/errors"
import { hashPassword } from "@/server/auth/password"
import { ONBOARDING_STEPS, type OnboardingStep } from "@/lib/domain/constants"
import { DEFAULT_CMS_CONTENT } from "@/lib/cms/defaults"
import { RESERVED_SUBDOMAINS } from "@/server/tenant/resolver"
import { listPaymentAccounts } from "@/server/payments/accounts"
import { recordAudit, type AuditActor } from "./audit"

/**
 * How an arena joins Game Slots, and how it is walked to its opening day.
 *
 * Registration creates four things that must exist together — an identity, an
 * organization, an arena and the membership that ties them — so it runs in one
 * transaction. A half-made tenant is worse than none: an organization with no
 * arena is invisible, and an arena with no owner is unreachable.
 *
 * The arena is created PENDING_SETUP, which means the public storefront is
 * not served yet (see `requirePublicTenant`). It becomes ACTIVE only when its
 * owner launches it.
 */

/** Slugs are hostnames: lowercase, hyphen-separated, and not one of ours. */
export const arenaSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens")
  .refine((slug) => !RESERVED_SUBDOMAINS.has(slug), "That address is reserved")

export const registerArenaSchema = z.object({
  // The person
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  password: z.string().min(10).max(200),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  // The business
  organizationName: z.string().trim().min(2).max(120),
  arenaName: z.string().trim().min(2).max(120),
  slug: arenaSlugSchema,
  city: z.string().trim().max(80).optional().or(z.literal("")),
})
export type RegisterArenaInput = z.infer<typeof registerArenaSchema>

export async function registerArena(input: RegisterArenaInput, meta: { ip?: string | null } = {}) {
  const database = await db()
  const email = input.email.toLowerCase()
  const passwordHash = await hashPassword(input.password)

  const ownerRole = await database.query.roles.findFirst({ where: eq(schema.roles.key, "ARENA_OWNER") })
  if (!ownerRole) throw new AppError("INTERNAL_ERROR", "Roles are not initialised")

  try {
    const created = await database.transaction(async (tx) => {
      // An existing Game Slots identity may open a second arena; the password
      // in the form is ignored in that case, because it would be a way to
      // overwrite someone else's credentials by knowing their address.
      const existingUser = await tx.query.users.findFirst({
        where: and(sql`lower(${schema.users.email}) = ${email}`, isNull(schema.users.deletedAt)),
      })
      const [user] = existingUser
        ? [existingUser]
        : await tx
            .insert(schema.users)
            .values({ name: input.name, email, phone: input.phone || null, passwordHash })
            .returning()

      const [organization] = await tx
        .insert(schema.organizations)
        .values({ slug: input.slug, name: input.organizationName, status: "ACTIVE", createdByUserId: user.id })
        .returning()

      const [arena] = await tx
        .insert(schema.arenas)
        .values({
          slug: input.slug,
          name: input.arenaName,
          city: input.city || null,
          organizationId: organization.id,
          status: "PENDING_SETUP",
          onboardingStep: "branding",
        })
        .returning()

      await tx
        .insert(schema.arenaMemberships)
        .values({ arenaId: arena.id, userId: user.id, roleId: ownerRole.id, status: "ACTIVE", acceptedAt: new Date() })

      // A storefront with no pages is a broken storefront, so it starts with
      // the same defaults the seeded arena has.
      for (const [slug, content] of Object.entries(DEFAULT_CMS_CONTENT)) {
        await tx.insert(schema.cmsPages).values({
          arenaId: arena.id,
          slug: slug as keyof typeof DEFAULT_CMS_CONTENT,
          draft: content,
          published: content,
          publishedAt: new Date(),
        })
      }
      await tx.insert(schema.systemSettings).values({ arenaId: arena.id, key: "siteName", value: input.arenaName })

      return { user, organization, arena, reusedIdentity: !!existingUser }
    })

    await recordAudit(
      { type: "user", id: created.user.id, name: created.user.name, ip: meta.ip },
      {
        action: "arena.register",
        entityType: "arena",
        entityId: created.arena.id,
        arenaId: created.arena.id,
        description: `${created.user.name} registered ${created.arena.name}`,
        metadata: { slug: created.arena.slug, reusedIdentity: created.reusedIdentity },
      }
    )
    return created
  } catch (err) {
    if (isUniqueViolation(err, "arenas_slug_unique") || isUniqueViolation(err, "organizations_slug_unique")) {
      throw new AppError("CONFLICT", "That address is already taken. Try another.")
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface OnboardingTask {
  step: OnboardingStep
  title: string
  description: string
  href: string
  done: boolean
  /** Launching is refused until every required task is done. */
  required: boolean
}

export interface OnboardingState {
  arenaId: string
  slug: string
  launched: boolean
  currentStep: OnboardingStep
  tasks: OnboardingTask[]
  /** 0–100, for the progress bar. Counts required tasks only. */
  percent: number
  canLaunch: boolean
}

/**
 * What is left before this arena can open, computed from what actually exists
 * rather than from a stored cursor. A step the owner completed by some other
 * route — adding a session from the sessions screen, say — counts.
 */
export async function getOnboardingState(arenaId: string): Promise<OnboardingState> {
  const database = await db()
  const arena = await database.query.arenas.findFirst({ where: eq(schema.arenas.id, arenaId) })
  if (!arena) throw notFound("Arena")

  const [{ sessions }] = await database
    .select({ sessions: sql<number>`count(*)::int` })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.arenaId, arenaId), isNull(schema.sessions.deletedAt)))
  const [{ staff }] = await database
    .select({ staff: sql<number>`count(*)::int` })
    .from(schema.arenaMemberships)
    .where(and(eq(schema.arenaMemberships.arenaId, arenaId), eq(schema.arenaMemberships.status, "ACTIVE")))
  const paymentAccounts = await listPaymentAccounts(arenaId)

  const tasks: OnboardingTask[] = [
    {
      step: "branding",
      title: "Make it yours",
      description: "Add your logo and colours so the site looks like your arena, not ours.",
      href: "/admin/settings",
      done: Boolean(arena.logoMediaId || arena.brandPrimaryColor),
      required: false,
    },
    {
      step: "payments",
      title: "Connect payments",
      description: "Your own provider account, so bookings are paid directly to you.",
      href: "/admin/settings",
      done: paymentAccounts.some((a) => a.status === "ACTIVE" && a.secretKeySet),
      required: true,
    },
    {
      step: "first_session",
      title: "Create your first session",
      description: "Eight teams of four. Set the date, the pitch and the price.",
      href: "/admin/sessions/new",
      done: Number(sessions) > 0,
      required: true,
    },
    {
      step: "staff",
      title: "Invite your team",
      description: "Managers, finance and the people on the gate. You can do this later.",
      href: "/admin/administrators",
      done: Number(staff) > 1,
      required: false,
    },
  ]

  const required = tasks.filter((t) => t.required)
  const doneRequired = required.filter((t) => t.done).length
  const launched = arena.status === "ACTIVE"
  return {
    arenaId,
    slug: arena.slug,
    launched,
    currentStep: launched ? "launched" : (tasks.find((t) => !t.done)?.step ?? "launched"),
    tasks,
    percent: launched ? 100 : Math.round((doneRequired / required.length) * 100),
    canLaunch: !launched && doneRequired === required.length,
  }
}

/** Advances the stored cursor so a returning owner lands where they left off. */
export async function recordOnboardingProgress(arenaId: string) {
  const state = await getOnboardingState(arenaId)
  const database = await db()
  await database
    .update(schema.arenas)
    .set({ onboardingStep: state.currentStep, updatedAt: new Date() })
    .where(and(eq(schema.arenas.id, arenaId), ne(schema.arenas.status, "ACTIVE")))
  return state
}

/**
 * Opens the arena to the public. Refused while a required task is outstanding
 * — an arena that cannot take payment is not open for business, whatever its
 * status column says.
 */
export async function launchArena(arenaId: string, ctx: { actor: AuditActor }) {
  const state = await getOnboardingState(arenaId)
  if (state.launched) return state
  if (!state.canLaunch) {
    const missing = state.tasks.filter((t) => t.required && !t.done).map((t) => t.title)
    throw new AppError("CONFLICT", `Finish these first: ${missing.join(", ")}`)
  }
  const database = await db()
  await database
    .update(schema.arenas)
    .set({ status: "ACTIVE", onboardingStep: "launched", launchedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.arenas.id, arenaId))
  await recordAudit(ctx.actor, {
    action: "arena.launch",
    entityType: "arena",
    entityId: arenaId,
    arenaId,
    description: "Opened the arena to the public",
  })
  return getOnboardingState(arenaId)
}

export { ONBOARDING_STEPS }
