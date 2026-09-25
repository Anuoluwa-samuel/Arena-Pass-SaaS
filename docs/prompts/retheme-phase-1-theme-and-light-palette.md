# Retheme phase 1 — theme system + whitish gradient light palette

Add a real light/dark mode to Game Slots and move the light theme to a whitish
gradient. No glassmorphism in this phase — glass is phase 2, and it is far
easier to judge once a real light background exists to judge it against.

## Read first
- `AGENTS.md` — this is Next.js 16; read the relevant guides in
  `node_modules/next/dist/docs/` before writing code. APIs may differ from what
  you remember.
- `docs/DESIGN.md` — the current design system. It says "dark-first"; you are
  changing that premise, so update this doc as part of the work.
- `app/globals.css` — all tokens live here as OKLCH vars for Tailwind 4
  (`@theme inline`) + shadcn. There is no tailwind.config.

## Current state (verify, don't trust)
- `next-themes` is a dependency and `components/theme-provider.tsx` wraps it,
  but NOTHING mounts it. `app/layout.tsx` has no provider and no
  `suppressHydrationWarning`.
- `components/ui/sonner.tsx` already calls `useTheme()` and is currently
  running without a provider above it.
- `:root` and `.dark` in `app/globals.css` are identical dark values. There is
  no light palette to fix — you are authoring one from scratch.

## 1. Wire up the theme system
- Mount `ThemeProvider` in `app/layout.tsx` with `attribute="class"`,
  `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`.
- Add `suppressHydrationWarning` to `<html>`. Remove the hardcoded
  `className="bg-background"` on `<html>` if it fights the gradient.
- No flash of wrong theme on first paint — verify with a hard reload under both
  system settings.
- Build a `components/theme-toggle.tsx` (light / dark / system). Mount it in
  `components/navbar.tsx` and `components/admin/admin-header.tsx`. It must be
  keyboard-operable with a real accessible name, and must not render mismatched
  icon markup during hydration.

## 2. Light palette — whitish gradient
- Author a genuine light `:root`: near-white surfaces, dark foreground, keeping
  the Game Slots green `--primary` as the single accent. It must stay
  recognisably the same product, not a generic white dashboard.
- Keep the existing dark values under `.dark`.
- The whitish gradient is a page-level ambient background, not a per-card
  effect: define it as a token (e.g. `--gradient-page`) set in both `:root` and
  `.dark` so one `body`/shell rule serves both themes. Soft, low-chroma, with a
  faint green cast pulled from `--primary` — no visible banding, no busy mesh.
- Re-tune the existing decorative CSS for light: `.pitch-lines`,
  `@keyframes pulse-glow`, `.animate-float-a/b`. `color-mix` against `--primary`
  at 60% will be far too loud on white.
- Charts: `components/admin/charts.tsx` hardcodes `#16a34a` for >=5:1 contrast on
  dark. Contrast-check it on the light surface and tokenize if it fails.
- The print stylesheet already forces white; confirm it still works.

## Constraints
- Tokens only — no new hardcoded hex/rgb in components. If you need a value,
  add a token in `app/globals.css` and expose it through `@theme inline`.
- Respect `prefers-reduced-motion`; the existing global rule in `globals.css`
  must keep covering anything new you add.
- Don't touch server/, API routes, or domain logic. This is presentation only.
- Keep `npm run lint`, `npm run typecheck`, `npm test` green. Check the
  Playwright specs in `tests/e2e/` still pass — they select real UI.

## Done means
- `npm run dev` (port 4000) and walk in BOTH themes: home, a session detail,
  checkout, a digital ticket, admin dashboard, admin data table.
- Screenshot each in light and dark and show me before you call it done.
- `docs/DESIGN.md` updated: it currently opens "Game Slots is dark-first" and
  documents a single palette. It needs the dual palette and the gradient token.
