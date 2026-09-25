import "server-only"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db, schema } from "@/server/db"
import { notFound } from "@/server/http/errors"
import { recordAudit, type AuditActor } from "@/server/services/audit"
import { HEX_PATTERN, normaliseHex, resolveBrandColour } from "@/lib/brand/color"

/**
 * One arena's colours.
 *
 * Branding lives on the arena row rather than in `system_settings` because it
 * is part of the tenant's identity — onboarding asks for it, and the storefront
 * reads it on every render. Both colours are optional: an arena that sets
 * neither inherits the platform palette, which is a deliberate default rather
 * than a missing value.
 */

const hex = z
  .string()
  .trim()
  .regex(HEX_PATTERN, "Use a hex colour such as #1d4ed8")
  .transform((v) => normaliseHex(v)!)

export const brandingSchema = z.object({
  // `null` clears the colour and returns that arena to the platform palette;
  // an absent key leaves it untouched.
  primaryColor: hex.nullable(),
  accentColor: hex.nullable(),
})

export type BrandingInput = { primaryColor: string | null; accentColor: string | null }

export interface Branding {
  primaryColor: string | null
  accentColor: string | null
  /** What each colour actually renders as, per theme. */
  resolved: {
    primary: ReturnType<typeof resolveBrandColour>
    accent: ReturnType<typeof resolveBrandColour>
  }
}

function describe(primary: string | null, accent: string | null): Branding {
  return {
    primaryColor: primary,
    accentColor: accent,
    resolved: {
      primary: primary ? resolveBrandColour(primary) : null,
      accent: accent ? resolveBrandColour(accent) : null,
    },
  }
}

/**
 * `arenas` is the one table `forArena()` cannot scope: it has no `arena_id`,
 * because it *is* the arena. The id here always comes from the caller's own
 * membership — `adminRoute` resolved it before the handler ran — so a lookup
 * by primary key is already tenant-scoped. `notFound` covers a deleted arena.
 */
async function requireArena(arenaId: string) {
  const database = await db()
  const arena = await database.query.arenas.findFirst({ where: eq(schema.arenas.id, arenaId) })
  if (!arena || arena.deletedAt) throw notFound("Arena")
  return arena
}

export async function getBranding(arenaId: string): Promise<Branding> {
  const arena = await requireArena(arenaId)
  return describe(normaliseHex(arena.brandPrimaryColor), normaliseHex(arena.brandAccentColor))
}

export async function updateBranding(
  arenaId: string,
  input: Partial<BrandingInput>,
  ctx: { actor: AuditActor }
): Promise<Branding> {
  const arena = await requireArena(arenaId)

  const next: { brandPrimaryColor: string | null; brandAccentColor: string | null } = {
    brandPrimaryColor: "primaryColor" in input ? input.primaryColor ?? null : arena.brandPrimaryColor,
    brandAccentColor: "accentColor" in input ? input.accentColor ?? null : arena.brandAccentColor,
  }

  const database = await db()
  const [updated] = await database
    .update(schema.arenas)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(schema.arenas.id, arenaId))
    .returning()

  await recordAudit(ctx.actor, {
    action: "arena.branding_update",
    entityType: "arena",
    entityId: arenaId,
    arenaId,
    // The colours themselves are the change, so they belong in the record —
    // there is nothing sensitive about them and support is asked about them.
    description: `Updated branding (primary ${next.brandPrimaryColor ?? "default"}, accent ${next.brandAccentColor ?? "default"})`,
  })

  return describe(normaliseHex(updated.brandPrimaryColor), normaliseHex(updated.brandAccentColor))
}
