import "server-only"
import { cache } from "react"
import { cookies } from "next/headers"
import { and, eq, gt, isNull } from "drizzle-orm"
import { db, schema } from "@/server/db"
import { env } from "@/server/env"
import { randomToken, sha256 } from "./tokens"
import { loadArenaMemberships, loadPlatformAccess, IMPERSONATION_PERMISSIONS, type ArenaAccess, type PlatformAccess } from "@/server/tenant/authorization"
import { getActiveImpersonation } from "@/server/services/platform"
import { getTenantContext } from "@/server/tenant/context"

export const ADMIN_COOKIE = "ap_admin_session"
export const CUSTOMER_COOKIE = "ap_customer_session"

const ADMIN_TTL_MS = 12 * 60 * 60 * 1000 // 12h
const CUSTOMER_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30d

type PrincipalType = "user" | "customer"

/**
 * An authenticated operator.
 *
 * There is no single `role` or `permissions` list any more, because there is
 * no single answer: what this user may do depends on *which arena* is being
 * acted on. `memberships` holds one entry per arena they may act in, each
 * with its own role and permissions, and `platform` holds their standing on
 * the platform itself. Authorisation reads these through
 * `server/tenant/authorization`; nothing else grants access.
 */
export interface AuthenticatedUser {
  id: string
  email: string
  name: string
  sessionId: string
  memberships: ArenaAccess[]
  platform: PlatformAccess | null
}

export interface AuthenticatedCustomer {
  id: string
  arenaId: string
  email: string
  name: string
  username: string | null
  phone: string | null
  emailVerifiedAt: Date | null
  sessionId: string
}

function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.isProd,
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  }
}

/** Creates a DB-backed session and returns the raw token (only ever stored hashed). */
export async function createAuthSession(
  principalType: PrincipalType,
  principalId: string,
  meta: { ip?: string | null; userAgent?: string | null }
) {
  const database = await db()
  const token = randomToken(32)
  const ttl = principalType === "user" ? ADMIN_TTL_MS : CUSTOMER_TTL_MS
  const [row] = await database
    .insert(schema.authSessions)
    .values({
      principalType,
      principalId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + ttl),
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
    })
    .returning()
  return { token, session: row, ttl }
}

export async function setSessionCookie(principalType: PrincipalType, token: string, ttl: number) {
  const store = await cookies()
  store.set(principalType === "user" ? ADMIN_COOKIE : CUSTOMER_COOKIE, token, cookieOptions(ttl))
}

export async function clearSessionCookie(principalType: PrincipalType) {
  const store = await cookies()
  store.set(principalType === "user" ? ADMIN_COOKIE : CUSTOMER_COOKIE, "", { ...cookieOptions(0), maxAge: 0 })
}

export async function revokeSession(sessionId: string) {
  const database = await db()
  await database.update(schema.authSessions).set({ revokedAt: new Date() }).where(eq(schema.authSessions.id, sessionId))
}

export async function revokeAllSessionsFor(principalType: PrincipalType, principalId: string) {
  const database = await db()
  await database
    .update(schema.authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.authSessions.principalType, principalType), eq(schema.authSessions.principalId, principalId)))
}

async function findLiveSession(principalType: PrincipalType, token: string | undefined) {
  if (!token) return null
  const database = await db()
  return database.query.authSessions.findFirst({
    where: and(
      eq(schema.authSessions.tokenHash, sha256(token)),
      eq(schema.authSessions.principalType, principalType),
      isNull(schema.authSessions.revokedAt),
      gt(schema.authSessions.expiresAt, new Date())
    ),
  })
}

/** Resolves the admin user for the current request (memoised per request). */
export const getCurrentUser = cache(async (): Promise<AuthenticatedUser | null> => {
  const store = await cookies()
  const session = await findLiveSession("user", store.get(ADMIN_COOKIE)?.value)
  if (!session) return null
  return loadUserPrincipal(session.principalId, session.id)
})

export async function loadUserPrincipal(userId: string, sessionId: string): Promise<AuthenticatedUser | null> {
  const database = await db()
  const user = await database.query.users.findFirst({
    where: and(eq(schema.users.id, userId), eq(schema.users.isActive, true), isNull(schema.users.deletedAt)),
  })
  if (!user) return null
  const [memberships, platform] = await Promise.all([
    loadArenaMemberships(user.id),
    loadPlatformAccess(user.platformRoleId),
  ])

  // A live impersonation adds one read-only arena to what this operator can
  // reach — and only while it lasts. It never replaces or widens a real
  // membership: if they are already a member, that access stands on its own.
  const impersonation = platform ? await getActiveImpersonation(user.id) : null
  if (impersonation && !memberships.some((m) => m.arenaId === impersonation.arenaId)) {
    const arena = await database.query.arenas.findFirst({ where: eq(schema.arenas.id, impersonation.arenaId) })
    if (arena) {
      memberships.push({
        arenaId: arena.id,
        arenaSlug: arena.slug,
        arenaName: arena.name,
        membershipId: `impersonation:${impersonation.id}`,
        roleKey: "STAFF",
        roleName: "Platform support (read-only)",
        permissions: [...IMPERSONATION_PERMISSIONS],
        impersonated: true,
        impersonationExpiresAt: impersonation.expiresAt,
      })
    }
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    sessionId,
    memberships,
    platform,
  }
}

/**
 * A customer account belongs to exactly one arena, so a session for it is
 * only valid on *that* arena's storefront.
 *
 * Without this check a customer signed in at one arena would appear signed in
 * at another — the reads are scoped so they would see no data, but the site
 * would greet them by name and offer them an account they do not have there.
 * Returns null on a mismatch, which every caller already treats as "signed
 * out".
 */
export async function loadCustomerPrincipal(
  customerId: string,
  arenaId: string,
  sessionId: string
): Promise<AuthenticatedCustomer | null> {
  const database = await db()
  const customer = await database.query.customers.findFirst({
    where: and(
      eq(schema.customers.id, customerId),
      eq(schema.customers.arenaId, arenaId),
      eq(schema.customers.isActive, true),
      isNull(schema.customers.deletedAt)
    ),
  })
  if (!customer) return null
  return {
    id: customer.id,
    arenaId: customer.arenaId,
    email: customer.email,
    name: customer.name,
    username: customer.username,
    phone: customer.phone,
    emailVerifiedAt: customer.emailVerifiedAt,
    sessionId,
  }
}

export const getCurrentCustomer = cache(async (): Promise<AuthenticatedCustomer | null> => {
  const store = await cookies()
  const session = await findLiveSession("customer", store.get(CUSTOMER_COOKIE)?.value)
  if (!session) return null
  // No storefront, no customer: a customer session means nothing off an arena.
  const tenant = await getTenantContext()
  if (!tenant) return null
  return loadCustomerPrincipal(session.principalId, tenant.arenaId, session.id)
})

/** Token-based variant for route handlers that receive the cookie header directly (e.g. tests). */
export async function getUserFromRequest(req: Request): Promise<AuthenticatedUser | null> {
  const token = readCookie(req, ADMIN_COOKIE)
  const session = await findLiveSession("user", token)
  if (!session) return null
  return loadUserPrincipal(session.principalId, session.id)
}

export function readCookie(req: Request, name: string) {
  const header = req.headers.get("cookie") ?? ""
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=")
    if (k === name) return decodeURIComponent(rest.join("="))
  }
  return undefined
}
