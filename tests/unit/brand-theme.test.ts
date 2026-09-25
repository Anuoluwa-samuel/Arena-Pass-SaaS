import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildArenaThemeCss, PLATFORM_HUE, __BASE_TOKENS } from "@/lib/brand/theme"
import { contrastRatio, hexToOklch, PAGE_BACKGROUND } from "@/lib/brand/color"
import { BRAND_PRESETS } from "@/lib/brand/presets"

const CSS = readFileSync(join(process.cwd(), "app/globals.css"), "utf8")

/** The `:root` and `.dark` declaration blocks, as text. */
function block(selector: string): string {
  const start = CSS.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`${selector} not found in globals.css`)
  return CSS.slice(start, CSS.indexOf("\n}", start))
}

function tokenValue(selector: string, name: string): [number, number, number] | null {
  const match = block(selector).match(new RegExp(`--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`))
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/**
 * `lib/brand/theme.ts` copies the platform's token values so it can rotate
 * them at runtime. Nothing in the type system ties the copy to the stylesheet,
 * so this is the tie: change a colour in globals.css without updating the
 * module and these fail, rather than tenants quietly getting a theme derived
 * from colours the product no longer uses.
 */
describe("the copied base tokens still match globals.css", () => {
  for (const mode of ["light", "dark"] as const) {
    const selector = mode === "light" ? ":root" : ".dark"

    it(`${mode}: every surface token`, () => {
      const drifted: string[] = []
      for (const [name, l, c, h] of __BASE_TOKENS.SURFACES[mode]) {
        const actual = tokenValue(selector, name)
        if (!actual) {
          drifted.push(`--${name} is no longer declared in ${selector}`)
          continue
        }
        if (actual[0] !== l || actual[1] !== c || actual[2] !== h) {
          drifted.push(`--${name}: globals.css has ${actual.join(" ")}, theme.ts has ${l} ${c} ${h}`)
        }
      }
      expect(drifted).toEqual([])
    })

    it(`${mode}: the ambient gradient stops`, () => {
      const declared = [...block(selector).matchAll(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\/\s*([\d.]+)\)/g)]
        .map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])].join(" "))
      for (const stop of __BASE_TOKENS.GRADIENTS[mode].stops) {
        expect(declared, `gradient stop ${stop.join(" ")}`).toContain(stop.join(" "))
      }
    })
  }

  it("the platform's own brand hue is what the module rotates from", () => {
    expect(tokenValue(":root", "primary")![2]).toBe(PLATFORM_HUE)
    expect(tokenValue(".dark", "primary")![2]).toBe(PLATFORM_HUE)
  })
})

describe("an arena's theme", () => {
  it("declares exactly the same tokens in both blocks", () => {
    // The injected stylesheet comes after globals.css and `:root` has the same
    // specificity as `.dark`, so any token written only into `:root` overrides
    // globals.css's dark value while dark mode is on. Leaving the near-neutral
    // foregrounds out of the dark list once put light-mode ink on a near-black
    // page at 1.01:1 — invisible body text on every branded arena.
    const light = new Set(__BASE_TOKENS.SURFACES.light.map(([n]) => n))
    const dark = new Set(__BASE_TOKENS.SURFACES.dark.map(([n]) => n))
    expect([...light].filter((n) => !dark.has(n)), "in :root but not .dark").toEqual([])
    expect([...dark].filter((n) => !light.has(n)), "in .dark but not :root").toEqual([])
  })

  it("keeps dark-mode body text on the dark page, not the light one", () => {
    const css = buildArenaThemeCss("#f97316", null)!
    const dark = css.slice(css.indexOf("}.dark{"))
    const bg = dark.match(/--background:oklch\(([\d.]+) /)!
    const fg = dark.match(/--foreground:oklch\(([\d.]+) /)!
    // A dark page needs light text. The regression wrote 0.19 here.
    expect(Number(bg[1])).toBeLessThan(0.3)
    expect(Number(fg[1])).toBeGreaterThan(0.7)
  })

  it("is nothing at all when the arena chose nothing", () => {
    expect(buildArenaThemeCss(null, null)).toBeNull()
  })

  it("repaints surfaces, not just the accent", () => {
    const css = buildArenaThemeCss("#6d28d9", "#9333ea")!
    // The page itself has to move, or the arena is the platform with a violet button.
    expect(css).toContain("--background:")
    expect(css).toContain("--gradient-page:")
    expect(css).toContain("--border:")
    expect(css).toContain("--sidebar-solid:")
  })

  it("leaves the semantic colours alone, so green still means paid", () => {
    const css = buildArenaThemeCss("#c2410c", "#b45309")!
    for (const token of ["--success", "--warning", "--destructive", "--danger-text", "--info-text"]) {
      expect(css, token).not.toContain(`${token}:`)
    }
  })

  it("writes both themes, because one value cannot serve both", () => {
    const css = buildArenaThemeCss("#15803d", null)!
    expect(css.startsWith(":root{")).toBe(true)
    expect(css).toContain("}.dark{")
  })

  it("moves only the hue of each surface, never its lightness or chroma", () => {
    const css = buildArenaThemeCss("#b91c1c", null)!
    const light = css.slice(0, css.indexOf("}.dark{"))
    for (const [name, l, c] of __BASE_TOKENS.SURFACES.light) {
      // Text tokens are allowed to move lightness — that is the contrast guard.
      if (["foreground", "muted-foreground", "card-foreground", "popover-foreground", "secondary-foreground", "sidebar-foreground", "sidebar-accent-foreground", "chart-axis"].includes(name)) continue
      const m = light.match(new RegExp(`--${name}:oklch\\(([\\d.]+) ([\\d.]+) `))
      expect(m, name).not.toBeNull()
      expect(Number(m![1]), `${name} lightness`).toBe(l)
      expect(Number(m![2]), `${name} chroma`).toBe(c)
    }
  })

  it("keeps body text readable on the retinted page for every preset", () => {
    for (const preset of BRAND_PRESETS) {
      const css = buildArenaThemeCss(preset.primary, preset.accent)!
      for (const [mode, chunk] of [
        ["light", css.slice(0, css.indexOf("}.dark{"))],
        ["dark", css.slice(css.indexOf("}.dark{"))],
      ] as const) {
        const bg = chunk.match(/--background:oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/)!
        const fg = chunk.match(/--foreground:oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/)
        const muted = chunk.match(/--muted-foreground:oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/)
        const background = { l: +bg[1], c: +bg[2], h: +bg[3] }
        for (const [label, m] of [["foreground", fg], ["muted-foreground", muted]] as const) {
          if (!m) continue
          const colour = { l: +m[1], c: +m[2], h: +m[3] }
          expect(contrastRatio(colour, background), `${preset.id} ${mode} ${label}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  it("keeps the chosen primary readable on the arena's own background", () => {
    for (const preset of BRAND_PRESETS) {
      const css = buildArenaThemeCss(preset.primary, null)!
      const light = css.slice(0, css.indexOf("}.dark{"))
      const bg = light.match(/--background:oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/)!
      const primary = light.match(/--primary:(#[0-9a-f]{6})/)!
      const ratio = contrastRatio(hexToOklch(primary[1])!, { l: +bg[1], c: +bg[2], h: +bg[3] })
      // The primary is tuned against the platform page; a retinted page of the
      // same lightness should not cost it more than a rounding error.
      expect(ratio, `${preset.id} primary on its own background`).toBeGreaterThanOrEqual(4.3)
    }
  })

  it("does not disturb the platform's own pages", () => {
    // Nothing here should depend on PAGE_BACKGROUND having been mutated.
    expect(PAGE_BACKGROUND.light.h).toBe(PLATFORM_HUE)
  })
})
