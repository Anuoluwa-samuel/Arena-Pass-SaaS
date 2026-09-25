import "server-only"
import { AppError, notFound } from "@/server/http/errors"
import { logger } from "@/server/observability/logger"

/**
 * Tenant-consistency guards.
 *
 * These are the last application-level check before a row is used: given a
 * row that was fetched and the arena the request is entitled to, do they
 * agree? Phase 6 makes most of these unrepresentable at the database level
 * with composite foreign keys; until then — and afterwards, for defence in
 * depth — nothing tenant-owned should be returned without passing through
 * one of these.
 */

interface TenantOwned {
  arenaId: string | null
}

/**
 * Returns the row only when it belongs to `arenaId`.
 *
 * A row belonging to another tenant is reported as *not found*, never as
 * forbidden: "forbidden" confirms the id exists, which is how an attacker
 * enumerates another arena's bookings.
 */
export function assertBelongsToArena<T extends TenantOwned>(row: T | null | undefined, arenaId: string, what = "Resource"): T {
  if (!row) throw notFound(what)
  if (row.arenaId !== arenaId) {
    logger.warn("tenant.cross_tenant_access_denied", { expected: arenaId, actual: row.arenaId, resource: what })
    throw notFound(what)
  }
  return row
}

/**
 * Refuses to relate two rows that live in different arenas — a booking to a
 * session, a ticket to a booking, a payment to a booking. Unlike the read
 * guard this is a conflict, not a 404: the caller supplied two ids that
 * cannot legally be combined.
 */
export function assertSameArena(
  a: { arenaId: string | null } | null | undefined,
  b: { arenaId: string | null } | null | undefined,
  context: string
): void {
  if (!a || !b) throw notFound(context)
  if (a.arenaId === null || b.arenaId === null || a.arenaId !== b.arenaId) {
    logger.warn("tenant.cross_tenant_relation_denied", { left: a.arenaId, right: b.arenaId, context })
    throw new AppError("CONFLICT", `Cannot relate resources from different arenas (${context})`)
  }
}

/**
 * Guards the arena id itself before it reaches a query. A service that takes
 * an `arenaId` parameter should never be reachable with an empty or absent
 * one, because `where arena_id = undefined` silently becomes an unscoped
 * read in some query builders.
 */
export function assertArenaId(arenaId: string | null | undefined, context: string): string {
  if (!arenaId) {
    logger.error("tenant.missing_arena_scope", { context })
    throw new AppError("INTERNAL_ERROR", "Tenant scope missing")
  }
  return arenaId
}
