import { readFile } from "node:fs/promises"
import { route } from "@/server/http/response"
import { notFound } from "@/server/http/errors"
import { resolveLocalFile } from "@/server/services/media"

/**
 * Serves locally stored uploads. Cloud storage serves files directly instead.
 *
 * Uploads are attacker-influenced bytes served from the same origin as the
 * admin and the storefront, so every response is locked down: the declared
 * type is never re-sniffed, the file cannot frame or be framed, and a content
 * security policy of `default-src 'none'; sandbox` means that even an SVG that
 * slipped past the upload check can neither run script nor reach the network.
 */
export const GET = route<{ params: Promise<{ key: string[] }> }>(async (_req, { params }) => {
  const { key } = await params
  const file = await resolveLocalFile(key.join("/"))
  if (!file) throw notFound("File")
  const data = await readFile(file.path)
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": file.mimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Frame-Options": "DENY",
      // Opened directly rather than via <img>, an SVG downloads instead of rendering.
      ...(file.mimeType === "image/svg+xml" ? { "Content-Disposition": "inline; filename=\"image.svg\"" } : {}),
    },
  })
})
