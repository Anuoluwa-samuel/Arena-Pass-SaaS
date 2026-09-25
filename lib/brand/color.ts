/**
 * Brand colour maths, shared by the picker in the browser and the validator on
 * the server — hence `lib/`, with no server-only imports.
 *
 * An arena picks one colour. That colour has to work on a near-white storefront
 * *and* on a near-black one, and a hex that looks right on one is usually
 * illegible on the other: mid-blue `#2563eb` is fine on white and muddy on
 * black; mint `#6ee7b7` is fine on black and invisible on white.
 *
 * So the colour is kept exactly as chosen wherever it already reads, and only
 * its lightness is moved when it does not. Hue and chroma — the part a person
 * actually means by "our colour" — are never altered.
 */

export interface Oklch {
  l: number
  c: number
  h: number
}

/** `#rgb` or `#rrggbb`, case-insensitive. Anything else is not a colour here. */
export const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

export function normaliseHex(value: string | null | undefined): string | null {
  if (!value) return null
  const hex = value.trim().toLowerCase()
  if (!HEX_PATTERN.test(hex)) return null
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  }
  return hex
}

const srgbToLinear = (u: number) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4)
const linearToSrgb = (u: number) => (u <= 0.0031308 ? 12.92 * u : 1.055 * u ** (1 / 2.4) - 0.055)
const clamp01 = (u: number) => Math.min(1, Math.max(0, u))

/** Linear sRGB triplet, unclamped so the caller can tell when a colour is out of gamut. */
function oklchToLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180
  const a = c * Math.cos(rad)
  const b = c * Math.sin(rad)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
}

export function hexToOklch(hex: string): Oklch | null {
  const full = normaliseHex(hex)
  if (!full) return null
  const [r, g, b] = [1, 3, 5].map((i) => srgbToLinear(parseInt(full.slice(i, i + 2), 16) / 255))
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  const h = (Math.atan2(bb, a) * 180) / Math.PI
  return { l: L, c: Math.hypot(a, bb), h: h < 0 ? h + 360 : h }
}

export function oklchToHex(colour: Oklch): string {
  const channels = oklchToLinearRgb(colour).map((u) => {
    const v = Math.round(clamp01(linearToSrgb(clamp01(u))) * 255)
    return v.toString(16).padStart(2, "0")
  })
  return `#${channels.join("")}`
}

/** WCAG relative luminance, from the clamped sRGB the browser would paint. */
function luminance(colour: Oklch): number {
  const [r, g, b] = oklchToLinearRgb(colour).map(clamp01)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: Oklch, b: Oklch): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * The page colours a brand colour has to survive, matching `app/globals.css`.
 * Kept here as numbers rather than read from CSS because the server validates
 * against them too, long before a stylesheet exists.
 */
export const PAGE_BACKGROUND = {
  light: { l: 0.925, c: 0.02, h: 255 },
  dark: { l: 0.1, c: 0.012, h: 255 },
} as const

/** Body-text contrast. A brand colour is used for links and labels, not just fills. */
const MIN_CONTRAST = 4.5

/**
 * The chosen colour if it already reads against that theme's page, otherwise
 * the nearest lightness that does.
 *
 * Only `l` moves. Walking it toward the readable end in small steps keeps the
 * result recognisably the same colour — a brand blue stays that blue, just
 * deep enough to read on white or bright enough to read on black.
 */
export function readableOn(mode: "light" | "dark", colour: Oklch): Oklch {
  const page = PAGE_BACKGROUND[mode]
  // Measured on the colour after it has been rounded to an 8-bit hex, because
  // that is what gets stored and what the browser paints. Checking the
  // unrounded value passes colours that land a hair under 4.5:1 once written
  // out — which is how a preset shipped at 4.4946:1.
  const reads = (c: Oklch) => contrastRatio(hexToOklch(oklchToHex(c)) ?? c, page) >= MIN_CONTRAST
  if (reads(colour)) return colour
  // Light pages need a darker colour, dark pages a lighter one.
  const step = mode === "light" ? -0.01 : 0.01
  let candidate = { ...colour }
  for (let i = 0; i < 100; i++) {
    candidate = { ...candidate, l: clamp01(candidate.l + step) }
    if (reads(candidate)) return candidate
    if (candidate.l <= 0 || candidate.l >= 1) break
  }
  // Unreachable for any real hue, but a colour is still owed: fall back to the
  // extreme rather than returning something that fails the check.
  return { ...candidate, l: mode === "light" ? 0.2 : 0.95 }
}

/** Whether white or near-black sits better on a filled button of this colour. */
export function foregroundFor(colour: Oklch): "light" | "dark" {
  const white = { l: 0.99, c: 0, h: 0 }
  const ink = { l: 0.15, c: 0, h: 0 }
  return contrastRatio(colour, white) >= contrastRatio(colour, ink) ? "light" : "dark"
}

export interface ResolvedBrandColour {
  /** Exactly what the arena chose, for showing back to them. */
  chosen: string
  light: string
  dark: string
  /** True when either theme needed the lightness moved to stay legible. */
  adjusted: boolean
}

/** What a chosen hex will actually render as in each theme. */
export function resolveBrandColour(hex: string): ResolvedBrandColour | null {
  const colour = hexToOklch(hex)
  if (!colour) return null
  const light = readableOn("light", colour)
  const dark = readableOn("dark", colour)
  return {
    chosen: normaliseHex(hex)!,
    light: oklchToHex(light),
    dark: oklchToHex(dark),
    adjusted: light.l !== colour.l || dark.l !== colour.l,
  }
}
