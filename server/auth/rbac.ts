import "server-only"
import type { Permission } from "@/lib/domain/constants"
import { unauthorized } from "@/server/http/errors"
import {
  authorizeArena,
  authorizePlatform,
  canInArena,
  canOnPlatform,
  type ArenaAccess,
  type PlatformAccess,
} from "@/server/tenant/authorization"
import { resolveAdminArena } from "@/server/tenant/admin-scope"
import { getCurrentUser, getCurrentCustomer, type AuthenticatedUser, type AuthenticatedCustomer } from "./session"

/**
 * Authentication + authorisation for admin surfaces.
 *
 * Every check answers a question about *one arena*, because there is no
 * permission a user simply "has" — they have it somewhere. The arena is
 * resolved from the request (see `server/tenant/admin-scope`), never supplied
 * by the caller.
 */

export interface ArenaSession {
  user: AuthenticatedUser
  arena: ArenaAccess
}

export interface PlatformSession {
  user: AuthenticatedUser
  platform: PlatformAccess
}

/** Throws UNAUTHORIZED when no admin session exists. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser()
  if (!user) throw unauthorized()
  return user
}

/**
 * The entry point for every admin page and handler: resolve who is asking,
 * which arena they are asking about, and whether they may. Throws
 * UNAUTHORIZED, FORBIDDEN or ARENA_SELECTION_REQUIRED.
 */
export async function requireArenaPermission(...permissions: Permission[]): Promise<ArenaSession> {
  const user = await requireUser()
  const scope = await resolveAdminArena(user)
  const arena = authorizeArena(user, scope.arenaId, ...permissions)
  return { user, arena }
}

/** Platform-level surfaces. Never satisfied by an arena membership. */
export async function requirePlatformPermission(...permissions: Permission[]): Promise<PlatformSession> {
  const user = await requireUser()
  return { user, platform: authorizePlatform(user, ...permissions) }
}

export async function requireCustomer(): Promise<AuthenticatedCustomer> {
  const customer = await getCurrentCustomer()
  if (!customer) throw unauthorized("Please sign in to continue")
  return customer
}

/**
 * Non-throwing checks, for deciding what to render. The server still enforces
 * the same permission on the request the rendered control makes — hiding a
 * button is a courtesy, not a control.
 */
export function can(access: Pick<ArenaAccess, "permissions"> | null | undefined, permission: Permission) {
  return !!access && access.permissions.includes(permission)
}

export { canInArena, canOnPlatform }
