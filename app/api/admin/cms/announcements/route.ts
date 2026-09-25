import { z } from "zod"
import { ok } from "@/server/http/response"
import { parseJson, parseQuery, paginationSchema } from "@/server/http/request"
import { adminRoute, actorFrom } from "@/server/http/admin"
import { listAnnouncements, createAnnouncement, announcementInputSchema } from "@/server/services/cms"

export const GET = adminRoute("cms.view", async (req, _ctx, user, arena) => {
  const q = parseQuery(req, paginationSchema.extend({ status: z.string().optional() }))
  const result = await listAnnouncements(arena.arenaId, q)
  return ok(result.items, { meta: result.meta })
})

export const POST = adminRoute("cms.manage", async (req, _ctx, user, arena) => {
  const input = await parseJson(req, announcementInputSchema)
  return ok(await createAnnouncement(arena.arenaId, input, { actor: actorFrom(user, req) }), { status: 201, message: "Announcement created" })
})
