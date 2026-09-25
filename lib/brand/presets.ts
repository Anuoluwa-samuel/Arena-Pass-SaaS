/**
 * Ready-made palettes for the arena branding picker.
 *
 * Most operators want "something that looks like us" rather than a specific
 * hex, and choosing two colours from a blank picker is a job nobody asked for.
 * These eight cover the usual ground; anyone with a real brand colour types it
 * in instead.
 *
 * Each pair is a primary with an accent from a neighbouring hue, so the two
 * never fight.
 *
 * None of them is stored as the colour that finally renders, and none could
 * be. Readable body text needs 4.5:1, which against this product's light page
 * means a luminance at or below 0.13, and against its dark page a luminance at
 * or above 0.21 — two ranges that do not overlap, for any hue. One hex
 * therefore cannot serve both themes, so `resolveBrandColour` derives a
 * lightness per theme and keeps the hue and chroma the operator chose. What is
 * stored here is the intent; what ships is computed from it.
 */

export interface BrandPreset {
  id: string
  name: string
  primary: string
  accent: string
}

export const BRAND_PRESETS: readonly BrandPreset[] = [
  { id: "pitch", name: "Pitch green", primary: "#15803d", accent: "#0d9488" },
  { id: "floodlight", name: "Floodlight blue", primary: "#1d4ed8", accent: "#0284c7" },
  { id: "sunset", name: "Sunset orange", primary: "#c2410c", accent: "#b45309" },
  { id: "clay", name: "Clay red", primary: "#b91c1c", accent: "#be123c" },
  { id: "violet", name: "Deep violet", primary: "#6d28d9", accent: "#9333ea" },
  { id: "ocean", name: "Ocean teal", primary: "#0f766e", accent: "#0369a1" },
  { id: "midnight", name: "Midnight", primary: "#334155", accent: "#475569" },
  { id: "plum", name: "Plum", primary: "#a21caf", accent: "#c026d3" },
] as const

export function presetById(id: string): BrandPreset | undefined {
  return BRAND_PRESETS.find((p) => p.id === id)
}

/** The preset matching a stored pair, so the picker can show it as selected. */
export function matchPreset(primary: string | null, accent: string | null): BrandPreset | undefined {
  if (!primary) return undefined
  return BRAND_PRESETS.find(
    (p) => p.primary === primary.toLowerCase() && (!accent || p.accent === accent.toLowerCase())
  )
}
