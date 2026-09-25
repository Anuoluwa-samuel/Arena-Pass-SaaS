import { ok } from "@/server/http/response"
import { adminRoute, actorFrom } from "@/server/http/admin"
import { getSettings, settingsSchema, updateSettings } from "@/server/services/settings"
import { recordAudit } from "@/server/services/audit"

export const GET = adminRoute("settings.view", async (_req, _ctx, user, arena) => ok(await getSettings(arena.arenaId)))

export const PATCH = adminRoute("settings.manage", async (req, _ctx, user, arena) => {
  const patch = settingsSchema.partial().parse(await req.json())
  const arenaId = arena.arenaId
  const settings = await updateSettings(patch, { arenaId, updatedBy: user.id })
  await recordAudit(actorFrom(user, req), { action: "settings.update", entityType: "settings", arenaId, description: `Updated system settings (${Object.keys(patch).join(", ")})` })
  return ok(settings, { message: "Settings saved" })
})
