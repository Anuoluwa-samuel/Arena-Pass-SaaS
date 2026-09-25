import "server-only"
import { cookies } from "next/headers"
import { AppError } from "@/server/http/errors"
import { env } from "@/server/env"
import { readCookie } from "@/server/auth/session"
import { getTenantContext, getTenantContextFromRequest } from "./context"
import type { Permission } from "@/lib/domain/constants"
import { authorizeArena, type ArenaAccess, type AuthorizableUser } from "./authorization"

/**
 * Which arena an admin request is acting on.
 *
 * The answer is never "the default one". It is, in order:
 *
 *  1. the arena the request is addressed to (hostname) — and the caller must
 *     be a member of it, or the request is refused rather than quietly
 *     redirected to an arena they *do* belong to;
 *  2. the arena they last selected, if they are still a member of it;
 *  3. their only membership, when they have exactly one;
 *  4. otherwise: choose one.
 *
 * Step 1 is the important one. Serving Arena A's data on Arena B's address
 * because the user happens to belong to A is exactly the confusion this whole
 * layer exists to prevent.
 */

export const SELECTED_ARENA_COOKIE = "ap_arena"

function membershipFor(user: AuthorizableUser, arenaId: string | null | undefined) {
  if (!arenaId) return undefined
  return user.memberships.find((m) => m.arenaId === arenaId)
}

function pick(user: AuthorizableUser, addressedArenaId: string | null, selectedArenaId: string | null): ArenaAccess {
  if (addressedArenaId) {
    const access = membershipFor(user, addressedArenaId)
    if (!access) {
      throw new AppError("FORBIDDEN", "You do not have access to this arena")
    }
    return access
  }

  const selected = membershipFor(user, selectedArenaId)
  if (selected) return selected

  if (user.memberships.length === 1) return user.memberships[0]
  if (user.memberships.length === 0) {
    throw new AppError("FORBIDDEN", "Your account is not a member of any arena")
  }
  throw new AppError("ARENA_SELECTION_REQUIRED", "Choose which arena to manage")
}

/** For server components and anything else that can read the request headers. */
export async function resolveAdminArena(user: AuthorizableUser): Promise<ArenaAccess> {
  const tenant = await getTenantContext()
  const store = await cookies()
  return pick(user, tenant?.arenaId ?? null, store.get(SELECTED_ARENA_COOKIE)?.value ?? null)
}

/** For route handlers, which hold the Request. */
export async function resolveAdminArenaFromRequest(user: AuthorizableUser, req: Request): Promise<ArenaAccess> {
  const tenant = await getTenantContextFromRequest(req)
  return pick(user, tenant?.arenaId ?? null, readCookie(req, SELECTED_ARENA_COOKIE) ?? null)
}

/**
 * Resolves the arena and checks the permissions in one step, so no caller can
 * do the first and forget the second.
 */
export async function requireArenaAccess(user: AuthorizableUser, ...permissions: Permission[]): Promise<ArenaAccess> {
  const access = await resolveAdminArena(user)
  return authorizeArena(user, access.arenaId, ...permissions)
}

/** Remembers the operator's choice. Validated against membership on every read. */
export async function setSelectedArenaCookie(arenaId: string) {
  const store = await cookies()
  store.set(SELECTED_ARENA_COOKIE, arenaId, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  })
}
