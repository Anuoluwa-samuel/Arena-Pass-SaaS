import { z } from "zod"
import { ok } from "@/server/http/response"
import { parseQuery, paginationSchema, getClientIp } from "@/server/http/request"
import { adminRoute, actorFrom } from "@/server/http/admin"
import { enforceRateLimit, RATE_LIMITS } from "@/server/http/rate-limit"
import { AppError } from "@/server/http/errors"
import { listMedia, uploadMedia } from "@/server/services/media"

export const GET = adminRoute("media.view", async (req, _ctx, _user, arena) => {
  const q = parseQuery(req, paginationSchema.extend({ folder: z.string().max(40).optional(), q: z.string().max(100).optional() }))
  const result = await listMedia(arena.arenaId, q)
  return ok(result.items, { meta: { ...result.meta, folders: result.folders } })
})

export const POST = adminRoute("media.manage", async (req, _ctx, user, arena) => {
  await enforceRateLimit(RATE_LIMITS.upload, `${user.id}:${getClientIp(req)}`)
  const form = await req.formData().catch(() => null)
  const file = form?.get("file")
  if (!form || !(file instanceof File)) throw new AppError("VALIDATION_ERROR", "Attach a file in the 'file' field")
  const folder = typeof form.get("folder") === "string" ? String(form.get("folder")) : undefined
  const altText = typeof form.get("altText") === "string" ? String(form.get("altText")).slice(0, 200) : undefined
  const buffer = Buffer.from(await file.arrayBuffer())
  const row = await uploadMedia({ buffer, originalName: file.name, mimeType: file.type }, { arenaId: arena.arenaId, folder, altText, actor: actorFrom(user, req) })
  return ok(row, { status: 201, message: "Uploaded" })
})
