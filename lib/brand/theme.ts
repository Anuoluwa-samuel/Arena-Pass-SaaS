import { contrastRatio, foregroundFor, hexToOklch, oklchToHex, resolveBrandColour, type Oklch } from "./color"

/**
 * Repaints a whole page in one arena's colour.
 *
 * Setting `--primary` alone leaves a violet arena looking like the platform
 * with violet buttons: the page stays blue-grey, because the background,
 * cards, borders and ambient gradient all carry the platform's own hue. This
 * rotates those too, so the tenant's colour is the colour of the site.
 *
 * Only the **hue** moves. Every lightness and chroma is the platform's, which
 * is what keeps a tenant from making their site unreadable: the surfaces stay
 * as pale (or as dark) as they were designed to be, and the text tokens keep
 * their separation from them. Rotating hue does shift relative luminance a
 * little, so the text tokens are re-checked afterwards and nudged if they slip
 * under 4.5:1.
 *
 * The base values below are the platform's, copied from `app/globals.css`.
 * That duplication is load-bearing and would rot silently, so a test parses
 * the stylesheet and fails if any of them drifts.
 */

/** The platform's own brand hue — the zero point every rotation is measured from. */
export const PLATFORM_HUE = 255

type Token = readonly [name: string, l: number, c: number, h: number]

/**
 * Tokens whose hue follows the arena. The semantic colours are deliberately
 * absent: success, warning, destructive and info mean something, and a paid
 * ticket should not change colour because a venue rebranded.
 *
 * `--primary`, `--accent` and the foregrounds that sit on them are absent too
 * — they are the chosen colours themselves, not a rotation of the platform's,
 * and are written separately.
 */
const SURFACES: Record<"light" | "dark", readonly Token[]> = {
  light: [
    ["background", 0.925, 0.02, 255],
    ["foreground", 0.19, 0.03, 260],
    ["card-foreground", 0.19, 0.03, 260],
    ["popover-solid", 0.975, 0.01, 255],
    ["popover-foreground", 0.19, 0.03, 260],
    ["secondary", 0.89, 0.022, 255],
    ["secondary-foreground", 0.22, 0.03, 260],
    ["muted", 0.89, 0.022, 255],
    ["muted-foreground", 0.4, 0.025, 260],
    ["border", 0.8, 0.025, 255],
    ["input", 0.87, 0.02, 255],
    ["sidebar-solid", 0.95, 0.015, 255],
    ["sidebar-foreground", 0.19, 0.03, 260],
    ["sidebar-accent", 0.88, 0.03, 255],
    ["sidebar-accent-foreground", 0.2, 0.03, 260],
    ["sidebar-border", 0.8, 0.025, 255],
    ["chart-2", 0.63, 0.14, 255],
    ["chart-3", 0.71, 0.12, 255],
    ["chart-4", 0.46, 0.13, 255],
    ["chart-5", 0.79, 0.09, 255],
    ["chart-grid", 0.82, 0.02, 255],
    ["chart-axis", 0.4, 0.025, 260],
    ["chart-cursor", 0.88, 0.03, 255],
    ["tile-bg", 0.19, 0.03, 260],
    ["streak-core", 0.85, 0.15, 255],
    ["streak-edge", 0.87, 0.1, 220],
    ["streak-glow", 0.86, 0.12, 230],
    ["shimmer", 0.62, 0.18, 255],
    // Chroma 0, so rotation is a no-op — present because every token written
    // into `:root` must also be written into `.dark`. See the note on
    // `themeBlock`.
    ["card-solid", 1, 0, 0],
    ["tile-fg", 0.99, 0, 0],
  ],
  dark: [
    ["background", 0.1, 0.012, 255],
    ["card-solid", 0.16, 0.01, 260],
    ["popover-solid", 0.16, 0.01, 260],
    ["secondary", 0.22, 0.01, 260],
    ["muted", 0.22, 0.01, 260],
    ["border", 0.28, 0.01, 260],
    ["input", 0.22, 0.01, 260],
    ["sidebar-solid", 0.14, 0.01, 260],
    ["sidebar-accent", 0.22, 0.01, 260],
    ["sidebar-border", 0.28, 0.01, 260],
    ["chart-2", 0.6, 0.15, 255],
    ["chart-3", 0.5, 0.12, 255],
    ["chart-4", 0.8, 0.15, 255],
    ["chart-5", 0.45, 0.1, 255],
    ["chart-grid", 0.24, 0.01, 260],
    ["chart-cursor", 0.2, 0.01, 260],
    ["tile-fg", 0.12, 0.01, 260],
    ["streak-core", 0.5, 0.16, 255],
    ["streak-edge", 0.4, 0.09, 220],
    ["streak-glow", 0.38, 0.12, 255],
    ["shimmer", 0.88, 0.15, 255],
    ["foreground", 0.98, 0, 0],
    ["card-foreground", 0.98, 0, 0],
    ["popover-foreground", 0.98, 0, 0],
    ["secondary-foreground", 0.98, 0, 0],
    ["muted-foreground", 0.75, 0, 0],
    ["sidebar-foreground", 0.98, 0, 0],
    ["sidebar-accent-foreground", 0.98, 0, 0],
    ["chart-axis", 0.6, 0, 0],
    ["tile-bg", 0.98, 0, 0],
  ],
}

/** The ambient aurora, as stop colours plus the geometry they belong to. */
const GRADIENTS: Record<"light" | "dark", { stops: readonly (readonly [number, number, number, number])[] }> = {
  light: {
    stops: [
      [0.87, 0.09, 255, 0.95],
      [0.88, 0.07, 220, 0.9],
      [0.89, 0.09, 255, 0.9],
      [0.88, 0.07, 220, 0.85],
    ],
  },
  dark: {
    stops: [
      [0.26, 0.09, 255, 0.95],
      [0.25, 0.07, 260, 0.9],
      [0.26, 0.08, 230, 0.9],
      [0.24, 0.06, 220, 0.85],
      [0.2, 0.045, 255, 0.7],
    ],
  },
}

const GRADIENT_SHAPES: Record<"light" | "dark", readonly string[]> = {
  light: [
    "radial-gradient(60% 55% at 6% 0%, %1, transparent 70%)",
    "radial-gradient(55% 50% at 98% 8%, %2, transparent 70%)",
    "radial-gradient(60% 55% at 85% 100%, %3, transparent 70%)",
    "radial-gradient(50% 45% at 0% 92%, %4, transparent 70%)",
  ],
  dark: [
    "radial-gradient(70% 60% at 6% 0%, %1, transparent 72%)",
    "radial-gradient(60% 55% at 98% 10%, %2, transparent 72%)",
    "radial-gradient(65% 60% at 85% 98%, %3, transparent 72%)",
    "radial-gradient(55% 50% at 2% 90%, %4, transparent 72%)",
    "radial-gradient(45% 40% at 50% 50%, %5, transparent 72%)",
  ],
}

/** The linear wash under the blobs: two stops, hue-rotated like the rest. */
const WASH: Record<"light" | "dark", readonly (readonly [number, number, number])[]> = {
  light: [
    [0.93, 0.02, 255],
    [0.9, 0.03, 220],
  ],
  dark: [
    [0.14, 0.02, 200],
    [0.12, 0.025, 220],
  ],
}

const rotate = (h: number, delta: number) => ((h + delta) % 360 + 360) % 360

const css = (c: Oklch) => `oklch(${round(c.l)} ${round(c.c)} ${round(c.h)})`
const cssAlpha = (c: Oklch, alpha: number) => `oklch(${round(c.l)} ${round(c.c)} ${round(c.h)} / ${alpha})`
const round = (n: number) => Math.round(n * 1000) / 1000

/** Body text must stay readable once the hue has moved under it. */
const MIN_CONTRAST = 4.5
const TEXT_TOKENS = new Set([
  "foreground",
  "muted-foreground",
  "card-foreground",
  "popover-foreground",
  "secondary-foreground",
  "sidebar-foreground",
  "sidebar-accent-foreground",
  "chart-axis",
])

function holdContrast(colour: Oklch, background: Oklch, mode: "light" | "dark"): Oklch {
  if (contrastRatio(colour, background) >= MIN_CONTRAST) return colour
  const step = mode === "light" ? -0.01 : 0.01
  let candidate = { ...colour }
  for (let i = 0; i < 100 && candidate.l > 0 && candidate.l < 1; i++) {
    candidate = { ...candidate, l: candidate.l + step }
    if (contrastRatio(candidate, background) >= MIN_CONTRAST) return candidate
  }
  return candidate
}

/**
 * Both blocks must declare exactly the same tokens.
 *
 * The injected stylesheet comes after globals.css, and `:root` and `.dark` have
 * equal specificity, so a token written only into `:root` beats globals.css's
 * `.dark` value *while dark mode is active*. Omitting the near-neutral
 * foregrounds here — on the reasoning that rotating a chroma of 0 does nothing
 * — put light-mode ink on a near-black page at 1.01:1. A test now asserts the
 * two lists match, because the compiler cannot.
 */
function themeBlock(mode: "light" | "dark", delta: number, primary: string, accent: string | null): string {
  const declarations: string[] = []

  const backgroundBase = SURFACES[mode].find(([n]) => n === "background")!
  const background: Oklch = { l: backgroundBase[1], c: backgroundBase[2], h: rotate(backgroundBase[3], delta) }

  for (const [name, l, c, h] of SURFACES[mode]) {
    let colour: Oklch = { l, c, h: rotate(h, delta) }
    if (TEXT_TOKENS.has(name)) colour = holdContrast(colour, background, mode)
    declarations.push(`--${name}:${css(colour)}`)
  }

  // The chosen colours themselves, at the lightness that reads in this theme.
  const p = resolveBrandColour(primary)!
  const pOklch = hexToOklch(p[mode])!
  for (const name of ["primary", "ring", "sidebar-primary", "sidebar-ring", "chart-1", "chart-mark"]) {
    declarations.push(`--${name}:${p[mode]}`)
  }
  const onPrimary = foregroundFor(pOklch) === "light" ? "oklch(0.99 0 0)" : "oklch(0.15 0 0)"
  declarations.push(`--primary-foreground:${onPrimary}`, `--sidebar-primary-foreground:${onPrimary}`)

  if (accent) {
    const a = resolveBrandColour(accent)!
    declarations.push(`--accent:${a[mode]}`)
    declarations.push(`--accent-foreground:${foregroundFor(hexToOklch(a[mode])!) === "light" ? "oklch(0.99 0 0)" : "oklch(0.15 0 0)"}`)
  }

  // Ambient gradient: same geometry, rotated stops.
  const stops = GRADIENTS[mode].stops.map(([l, c, h, alpha]) => cssAlpha({ l, c, h: rotate(h, delta) }, alpha))
  const blobs = GRADIENT_SHAPES[mode].map((shape, i) => shape.replace(`%${i + 1}`, stops[i]))
  const wash = WASH[mode].map(([l, c, h]) => css({ l, c, h: rotate(h, delta) }))
  declarations.push(`--gradient-page:${[...blobs, `linear-gradient(160deg, ${wash[0]} 0%, ${wash[1]} 100%)`].join(",")}`)

  return declarations.join(";")
}

/**
 * The full CSS for one arena, as `:root` (light) and `.dark` blocks.
 *
 * Returns null when the arena has chosen nothing, so the caller renders no
 * style element at all and the platform palette stands.
 */
export function buildArenaThemeCss(primary: string | null, accent: string | null): string | null {
  if (!primary) {
    // An accent alone is not enough to retint a page, and guessing a primary
    // from it would be inventing a decision the operator did not make.
    if (!accent) return null
    const a = resolveBrandColour(accent)
    if (!a) return null
    return `:root{--accent:${a.light}}.dark{--accent:${a.dark}}`
  }
  const chosen = hexToOklch(primary)
  if (!chosen) return null
  const delta = chosen.h - PLATFORM_HUE
  return `:root{${themeBlock("light", delta, primary, accent)}}.dark{${themeBlock("dark", delta, primary, accent)}}`
}

/** Exposed for the test that guards these values against `app/globals.css`. */
export const __BASE_TOKENS = { SURFACES, GRADIENTS, WASH }
export { oklchToHex }
