import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { db, schema, type DbExecutor } from "@/server/db"
import { BOOKING_HOLD_MINUTES, DEFAULT_CURRENCY, SESSION_DEFAULTS } from "@/lib/domain/constants"

/**
 * Typed settings with defaults. Values are stored as JSON per arena (or
 * globally when arenaId is null). Admins edit these from System Settings;
 * nothing here requires a deploy to change.
 */
export const settingsSchema = z.object({
  siteName: z.string().min(1).max(80).default("Game Slots"),
  currency: z.string().length(3).default(DEFAULT_CURRENCY),
  timezone: z.string().default("Africa/Lagos"),
  defaultTeamsCount: z.number().int().min(1).max(8).default(SESSION_DEFAULTS.teamsCount),
  defaultPlayersPerTeam: z.number().int().min(1).max(4).default(SESSION_DEFAULTS.playersPerTeam),
  defaultTicketPrice: z.number().int().min(0).default(500_000),
  bookingHoldMinutes: z.number().int().min(2).max(60).default(BOOKING_HOLD_MINUTES),
  serviceFeePercent: z.number().min(0).max(50).default(0),
  supportEmail: z.string().email().or(z.literal("")).default(""),
  supportPhone: z.string().max(40).default(""),
  sessionReminderHours: z.number().int().min(0).max(72).default(24),
  allowGuestCheckout: z.boolean().default(true),
  maintenanceMode: z.boolean().default(false),
})
export type Settings = z.infer<typeof settingsSchema>
export const SETTINGS_DEFAULTS: Settings = settingsSchema.parse({})

export async function getSettings(arenaId?: string | null, executor?: DbExecutor): Promise<Settings> {
  const database = executor ?? (await db())
  const rows = await database.query.systemSettings.findMany({
    where: arenaId ? eq(schema.systemSettings.arenaId, arenaId) : isNull(schema.systemSettings.arenaId),
  })
  const merged: Record<string, unknown> = {}
  for (const row of rows) merged[row.key] = row.value
  const parsed = settingsSchema.safeParse(merged)
  return parsed.success ? parsed.data : SETTINGS_DEFAULTS
}

export async function updateSettings(
  patch: Partial<Settings>,
  opts: { arenaId?: string | null; updatedBy?: string | null }
): Promise<Settings> {
  const database = await db()
  const validated = settingsSchema.partial().parse(patch)
  for (const [key, value] of Object.entries(validated)) {
    if (value === undefined) continue
    const existing = await database.query.systemSettings.findFirst({
      where: and(
        opts.arenaId ? eq(schema.systemSettings.arenaId, opts.arenaId) : isNull(schema.systemSettings.arenaId),
        eq(schema.systemSettings.key, key)
      ),
    })
    if (existing) {
      await database
        .update(schema.systemSettings)
        .set({ value, updatedBy: opts.updatedBy ?? null, updatedAt: new Date() })
        .where(eq(schema.systemSettings.id, existing.id))
    } else {
      await database
        .insert(schema.systemSettings)
        .values({ arenaId: opts.arenaId ?? null, key, value, updatedBy: opts.updatedBy ?? null })
    }
  }
  return getSettings(opts.arenaId)
}
