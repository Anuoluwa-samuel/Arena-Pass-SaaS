import { buildArenaThemeCss } from "@/lib/brand/theme"

/**
 * Applies one arena's colour to its own pages — the whole page, not only the
 * buttons.
 *
 * Overriding `--primary` alone left a violet arena looking like the platform
 * with violet buttons, because the background, cards, borders and ambient
 * gradient all carried the platform's hue. `buildArenaThemeCss` rotates those
 * too, moving only hue so every lightness and chroma stays as designed, and
 * re-checking the text tokens afterwards.
 *
 * Two blocks are emitted because one colour cannot read on both a light and a
 * dark page: the luminance bands that clear 4.5:1 against each do not overlap
 * at any hue. `:root` carries the light values and `.dark` the dark ones,
 * matching globals.css, so next-themes switching the class switches these too.
 *
 * Rendering nothing when an arena has chosen nothing leaves the platform
 * palette in place, which is the intended default rather than a gap.
 */
export function ArenaTheme({ primaryColor, accentColor }: { primaryColor: string | null; accentColor: string | null }) {
  const css = buildArenaThemeCss(primaryColor, accentColor)
  if (!css) return null
  return <style>{css}</style>
}
