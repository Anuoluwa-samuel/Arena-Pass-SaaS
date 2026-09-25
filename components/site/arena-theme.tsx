/**
 * Applies one arena's colours to its storefront.
 *
 * The values are already restricted to `#rgb` / `#rrggbb` by the content
 * service, so they can be written into CSS custom properties; anything else
 * was dropped before it got here. Rendering nothing when an arena has set no
 * colours keeps the product's default palette.
 */
export function ArenaTheme({ primaryColor, accentColor }: { primaryColor: string | null; accentColor: string | null }) {
  if (!primaryColor && !accentColor) return null
  const declarations = [
    primaryColor ? `--primary:${primaryColor};--sidebar-primary:${primaryColor};--ring:${primaryColor}` : "",
    accentColor ? `--accent:${accentColor};--sidebar-accent:${accentColor}` : "",
  ]
    .filter(Boolean)
    .join(";")
  return <style>{`:root{${declarations}}`}</style>
}
