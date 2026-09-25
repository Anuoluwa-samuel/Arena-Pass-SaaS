import { describe, it, expect } from "vitest"
import {
  contrastRatio,
  hexToOklch,
  normaliseHex,
  oklchToHex,
  PAGE_BACKGROUND,
  readableOn,
  resolveBrandColour,
} from "@/lib/brand/color"
import { BRAND_PRESETS, matchPreset } from "@/lib/brand/presets"

describe("hex parsing", () => {
  it("accepts both lengths and normalises to lowercase six digits", () => {
    expect(normaliseHex("#ABC")).toBe("#aabbcc")
    expect(normaliseHex("  #1D4ED8 ")).toBe("#1d4ed8")
  })

  it("rejects anything that is not a hex colour", () => {
    for (const bad of ["", "red", "#12", "#12345", "#1234567", "rgb(0,0,0)", "#12345g", null, undefined]) {
      expect(normaliseHex(bad as string | null), String(bad)).toBeNull()
    }
  })
})

describe("oklch round trip", () => {
  it("returns the colour it was given", () => {
    for (const hex of ["#1d4ed8", "#22c55e", "#ffffff", "#000000", "#c026d3"]) {
      const round = oklchToHex(hexToOklch(hex)!)
      // One step of 8-bit rounding is tolerable; a wrong matrix is not.
      const channels = [1, 3, 5].map((i) => Math.abs(parseInt(round.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16)))
      expect(Math.max(...channels), `${hex} -> ${round}`).toBeLessThanOrEqual(1)
    }
  })
})

describe("readability", () => {
  const MIN = 4.5

  it("leaves a colour alone when it already reads", () => {
    // Deep blue on the light page is already past 4.5:1.
    const colour = hexToOklch("#1d4ed8")!
    expect(contrastRatio(colour, PAGE_BACKGROUND.light)).toBeGreaterThanOrEqual(MIN)
    expect(readableOn("light", colour).l).toBe(colour.l)
  })

  it("moves only lightness, never the hue or chroma someone chose", () => {
    const colour = hexToOklch("#6ee7b7")!
    const fixed = readableOn("light", colour)
    expect(fixed.l).not.toBe(colour.l)
    expect(fixed.h).toBe(colour.h)
    expect(fixed.c).toBe(colour.c)
  })

  it("reaches 4.5:1 on both pages for every hue, measured on the rendered hex", () => {
    // Quantised on purpose: the guarantee is about the colour that ships, not
    // the floating-point one in the middle of the calculation.
    for (let h = 0; h < 360; h += 15) {
      for (const l of [0.2, 0.5, 0.8]) {
        const colour = { l, c: 0.15, h }
        for (const mode of ["light", "dark"] as const) {
          const rendered = hexToOklch(oklchToHex(readableOn(mode, colour)))!
          const ratio = contrastRatio(rendered, PAGE_BACKGROUND[mode])
          expect(ratio, `h${h} l${l} ${mode}`).toBeGreaterThanOrEqual(MIN)
        }
      }
    }
  })

  it("cannot serve both themes with one value, which is why there are two", () => {
    // The premise the whole module rests on: if some hex were readable on both
    // pages, per-theme derivation would be unnecessary complexity. None is.
    let both = 0
    for (let h = 0; h < 360; h += 5) {
      for (let l = 0.05; l <= 0.95; l += 0.05) {
        for (const c of [0, 0.08, 0.16]) {
          const colour = { l, c, h }
          if (
            contrastRatio(colour, PAGE_BACKGROUND.light) >= MIN &&
            contrastRatio(colour, PAGE_BACKGROUND.dark) >= MIN
          ) {
            both++
          }
        }
      }
    }
    expect(both).toBe(0)
  })
})

describe("resolveBrandColour", () => {
  it("reports the chosen colour alongside what each theme will render", () => {
    const resolved = resolveBrandColour("#22c55e")!
    expect(resolved.chosen).toBe("#22c55e")
    expect(resolved.light).not.toBe(resolved.dark)
    expect(contrastRatio(hexToOklch(resolved.light)!, PAGE_BACKGROUND.light)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(hexToOklch(resolved.dark)!, PAGE_BACKGROUND.dark)).toBeGreaterThanOrEqual(4.5)
  })

  it("refuses a value that is not a colour", () => {
    expect(resolveBrandColour("periwinkle")).toBeNull()
  })
})

describe("presets", () => {
  it("every preset resolves to a readable pair in both themes", () => {
    for (const preset of BRAND_PRESETS) {
      for (const hex of [preset.primary, preset.accent]) {
        const r = resolveBrandColour(hex)
        expect(r, `${preset.id} ${hex}`).not.toBeNull()
        expect(contrastRatio(hexToOklch(r!.light)!, PAGE_BACKGROUND.light)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(hexToOklch(r!.dark)!, PAGE_BACKGROUND.dark)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it("has no duplicate ids or colours, so the picker cannot show two identical swatches", () => {
    expect(new Set(BRAND_PRESETS.map((p) => p.id)).size).toBe(BRAND_PRESETS.length)
    expect(new Set(BRAND_PRESETS.map((p) => p.primary)).size).toBe(BRAND_PRESETS.length)
  })

  it("matches a stored pair back to its preset, and nothing else", () => {
    const first = BRAND_PRESETS[0]
    expect(matchPreset(first.primary.toUpperCase(), first.accent)?.id).toBe(first.id)
    expect(matchPreset("#123456", "#654321")).toBeUndefined()
    expect(matchPreset(null, null)).toBeUndefined()
  })
})
