"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { api, errorMessage } from "@/lib/api-client"
import { BRAND_PRESETS, matchPreset } from "@/lib/brand/presets"
import { HEX_PATTERN, normaliseHex, resolveBrandColour } from "@/lib/brand/color"

interface Props {
  initial: { primaryColor: string | null; accentColor: string | null }
  canManage: boolean
}

/**
 * Where an arena picks its own colours.
 *
 * The preview is computed with the same function the server stores and the
 * storefront renders with, so what an operator sees here is what their
 * customers get — including the per-theme lightness, which is why both a light
 * and a dark swatch are shown rather than one.
 */
export function BrandingForm({ initial, canManage }: Props) {
  const router = useRouter()
  const [primary, setPrimary] = useState(initial.primaryColor ?? "")
  const [accent, setAccent] = useState(initial.accentColor ?? "")
  const [busy, setBusy] = useState(false)

  const selected = matchPreset(primary || null, accent || null)
  const preview = useMemo(
    () => ({
      primary: HEX_PATTERN.test(primary) ? resolveBrandColour(primary) : null,
      accent: HEX_PATTERN.test(accent) ? resolveBrandColour(accent) : null,
    }),
    [primary, accent]
  )

  const dirty = (primary || null) !== initial.primaryColor || (accent || null) !== initial.accentColor
  const invalid = (primary !== "" && !HEX_PATTERN.test(primary)) || (accent !== "" && !HEX_PATTERN.test(accent))

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (invalid) return
    setBusy(true)
    try {
      await api.patch("/api/admin/branding", {
        primaryColor: primary ? normaliseHex(primary) : null,
        accentColor: accent ? normaliseHex(accent) : null,
      })
      toast.success("Branding saved")
      router.refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    setPrimary("")
    setAccent("")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your colours</CardTitle>
        <CardDescription>
          Used across your booking site and this admin. Leave both empty to use the platform palette.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <fieldset disabled={!canManage} className="space-y-6">
          <div>
            <Label className="mb-3 block">Palettes</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {BRAND_PRESETS.map((p) => {
                const active = selected?.id === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPrimary(p.primary)
                      setAccent(p.accent)
                    }}
                    aria-pressed={active}
                    className={`group relative flex items-center gap-2 rounded-xl border p-2.5 text-left transition-colors ${
                      active ? "border-primary bg-primary/10" : "border-border hover:bg-muted/60"
                    }`}
                  >
                    <span className="flex shrink-0 -space-x-1.5">
                      <span className="size-5 rounded-full ring-1 ring-black/10" style={{ background: p.primary }} />
                      <span className="size-5 rounded-full ring-1 ring-black/10" style={{ background: p.accent }} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{p.name}</span>
                    {active && <Check className="size-3.5 shrink-0 text-primary" aria-hidden />}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ColourField id="primaryColor" label="Primary" value={primary} onChange={setPrimary} />
            <ColourField id="accentColor" label="Accent" value={accent} onChange={setAccent} />
          </div>

          {(preview.primary || preview.accent) && (
            <div className="rounded-xl border p-4">
              <p className="text-sm font-medium">How it renders</p>
              <p className="mt-1 text-xs text-muted-foreground">
                One colour cannot be readable on both a light and a dark page, so each theme gets the same
                hue at a lightness that reads against it.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {(["light", "dark"] as const).map((mode) => (
                  <div
                    key={mode}
                    className="rounded-lg border p-3"
                    style={{ background: mode === "light" ? "#dee7f4" : "#020306" }}
                  >
                    <p
                      className="font-mono text-[10px] uppercase tracking-wider"
                      style={{ color: mode === "light" ? "#404855" : "#9aa3b2" }}
                    >
                      {mode}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      {preview.primary && (
                        <span
                          className="rounded-md px-2.5 py-1 text-xs font-medium text-white"
                          style={{ background: preview.primary[mode] }}
                        >
                          Book now
                        </span>
                      )}
                      {preview.accent && (
                        <span className="text-xs font-medium" style={{ color: preview.accent[mode] }}>
                          Accent text
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </fieldset>

        <form onSubmit={save} className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!canManage || busy || !dirty || invalid}>
            {busy && <Spinner className="mr-2 size-4" />}
            Save branding
          </Button>
          {(primary || accent) && canManage && (
            <Button type="button" variant="ghost" onClick={reset} disabled={busy}>
              <RotateCcw className="mr-2 size-4" />
              Use platform colours
            </Button>
          )}
          {invalid && <span className="text-xs text-destructive">Use a hex colour such as #1d4ed8.</span>}
        </form>
      </CardContent>
    </Card>
  )
}

function ColourField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
}) {
  const valid = value === "" || HEX_PATTERN.test(value)
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        {/* The native picker is the quickest way to land on a colour; the text
            field is how someone pastes the exact hex from a brand guide. */}
        <input
          type="color"
          aria-label={`${label} colour picker`}
          value={valid && value ? normaliseHex(value)! : "#1d4ed8"}
          onChange={(e) => onChange(e.target.value)}
          className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
        />
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder="Platform default"
          aria-invalid={!valid}
          className="font-mono"
        />
      </div>
    </div>
  )
}
