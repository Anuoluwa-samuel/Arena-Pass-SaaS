import { resolveBrandColour } from "@/lib/brand/color"

/**
 * Applies one arena's colours to its own pages.
 *
 * The arena stores a single hex per slot, but a single hex cannot serve both
 * themes: readable body text needs 4.5:1, which on the light page means a
 * luminance at or below 0.13 and on the dark page one at or above 0.21 — two
 * ranges that never overlap. So each colour is written twice, at the lightness
 * that reads against that theme's background, keeping the hue and chroma the
 * operator chose. `resolveBrandColour` does the work and is unit-tested.
 *
 * Rendering nothing when an arena has set no colours leaves the platform
 * palette in place, which is the intended default rather than a gap.
 */
export function ArenaTheme({ primaryColor, accentColor }: { primaryColor: string | null; accentColor: string | null }) {
  const primary = primaryColor ? resolveBrandColour(primaryColor) : null
  const accent = accentColor ? resolveBrandColour(accentColor) : null
  if (!primary && !accent) return null

  const block = (mode: "light" | "dark") =>
    [
      primary ? `--primary:${primary[mode]};--sidebar-primary:${primary[mode]};--ring:${primary[mode]};--sidebar-ring:${primary[mode]}` : "",
      accent ? `--accent:${accent[mode]};--sidebar-accent:${accent[mode]}` : "",
    ]
      .filter(Boolean)
      .join(";")

  // `:root` carries the light values and `.dark` the dark ones, matching how
  // globals.css is organised, so next-themes switching the class switches
  // these too. Both selectors are written out because a nonce'd <style> cannot
  // rely on a media query — the theme is a class, not a device preference.
  const css = `:root{${block("light")}}.dark{${block("dark")}}`
  return <style>{css}</style>
}
