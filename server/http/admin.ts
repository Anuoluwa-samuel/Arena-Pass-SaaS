import "server-only"
import type { Permission } from "@/lib/domain/constants"
import { requireUser } from "@/server/auth/rbac"
import type { AuthenticatedUser } from "@/server/auth/session"
import { authorizeArena, authorizePlatform, type ArenaAccess, type PlatformAccess } from "@/server/tenant/authorization"
import { resolveAdminArenaFromRequest } from "@/server/tenant/admin-scope"
import type { AuditActor } from "@/server/services/audit"
import { assertSameOrigin, getClientIp } from "./request"
import { route } from "./response"

export type AdminHandler<Ctx> = (req: Request, ctx: Ctx, user: AuthenticatedUser, arena: ArenaAccess) => Promise<Response>
export type PlatformHandler<Ctx> = (req: Request, ctx: Ctx, user: AuthenticatedUser, platform: PlatformAccess) => Promise<Response>

/**
 * Every arena admin endpoint runs this first: same-origin check for
 * mutations, then authentication, then arena resolution, then the permission
 * check against *that* arena.
 *
 * The arena is handed to the handler, so a handler cannot forget to scope its
 * work and cannot choose an arena of its own. The UI may hide buttons; this
 * is where authorisation happens.
 */
export function adminRoute<Ctx = { params: Promise<Record<string, string>> }>(
  permission: Permission | Permission[],
  handler: AdminHandler<Ctx>
) {
  const perms = Array.isArray(permission) ? permission : [permission]
  return route<Ctx>(async (req, ctx) => {
    assertSameOrigin(req)
    const user = await requireUser()
    const scope = await resolveAdminArenaFromRequest(user, req)
    const arena = authorizeArena(user, scope.arenaId, ...perms)
    return handler(req, ctx, user, arena)
  })
}

/**
 * Platform endpoints. Deliberately a separate wrapper: a platform permission
 * is never satisfied by an arena membership, and a platform handler is never
 * handed an arena scope by accident.
 */
export function platformRoute<Ctx = { params: Promise<Record<string, string>> }>(
  permission: Permission | Permission[],
  handler: PlatformHandler<Ctx>
) {
  const perms = Array.isArray(permission) ? permission : [permission]
  return route<Ctx>(async (req, ctx) => {
    assertSameOrigin(req)
    const user = await requireUser()
    const platform = authorizePlatform(user, ...perms)
    return handler(req, ctx, user, platform)
  })
}

export function actorFrom(user: AuthenticatedUser, req: Request): AuditActor & { id: string } {
  return { type: "user", id: user.id, name: user.name, ip: getClientIp(req) }
}
