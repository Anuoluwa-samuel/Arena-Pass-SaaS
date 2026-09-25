import "server-only"
import { and, eq, isNull, sql } from "drizzle-orm"
import { db, schema } from "@/server/db"
import { AppError } from "@/server/http/errors"
import { hashPassword, verifyPassword } from "./password"
import { createAuthSession, setSessionCookie, clearSessionCookie, revokeSession, loadUserPrincipal } from "./session"
import { recordAudit } from "@/server/services/audit"

interface RequestMeta {
  ip?: string | null
  userAgent?: string | null
  /**
   * The arena the sign-in was addressed to, when the hostname resolved to one.
   * A staff identity can span arenas, so the login is recorded against the
   * storefront it happened on rather than against every membership.
   */
  arenaId?: string | null
}

export async function loginUser(email: string, password: string, meta: RequestMeta) {
  const database = await db()
  const user = await database.query.users.findFirst({
    where: and(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`, isNull(schema.users.deletedAt)),
  })
  // Always run the hash comparison so timing does not reveal whether the email exists.
  const valid = await verifyPassword(password, user?.passwordHash ?? "scrypt$16384$8$1$AAAA$AAAA")
  if (!user || !valid) throw new AppError("INVALID_CREDENTIALS", "Incorrect email or password")
  if (!user.isActive) throw new AppError("ACCOUNT_DISABLED", "This account has been disabled")

  const { token, session, ttl } = await createAuthSession("user", user.id, meta)
  await setSessionCookie("user", token, ttl)
  await database.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id))
  await recordAudit(
    { type: "user", id: user.id, name: user.name, ip: meta.ip },
    { action: "auth.login", description: `${user.name} signed in`, arenaId: meta.arenaId ?? null }
  )
  return loadUserPrincipal(user.id, session.id)
}

export async function logoutUser(sessionId: string, actor: { id: string; name: string; arenaId?: string | null; ip?: string | null }) {
  await revokeSession(sessionId)
  await clearSessionCookie("user")
  await recordAudit(
    { type: "user", id: actor.id, name: actor.name, ip: actor.ip },
    { action: "auth.logout", description: `${actor.name} signed out`, arenaId: actor.arenaId ?? null }
  )
}

/**
 * Customer accounts belong to one arena. The same person signing up at two
 * arenas gets two accounts, which is what the arenas expect: neither can see
 * the other's customer list, and neither should be able to tell that the
 * address is in use elsewhere.
 */
export async function signupCustomer(
  arenaId: string,
  input: { name: string; email: string; phone?: string; password: string },
  meta: RequestMeta
) {
  const database = await db()
  const existing = await database.query.customers.findFirst({
    where: and(sql`lower(${schema.customers.email}) = ${input.email.toLowerCase()}`, eq(schema.customers.arenaId, arenaId)),
  })
  let customer: schema.Customer
  if (existing && existing.passwordHash) {
    throw new AppError("EMAIL_TAKEN", "An account with this email already exists")
  } else if (existing) {
    // Guest checkout customer upgrading to a full account.
    ;[customer] = await database
      .update(schema.customers)
      .set({ name: input.name, phone: input.phone ?? existing.phone, passwordHash: await hashPassword(input.password), updatedAt: new Date() })
      .where(eq(schema.customers.id, existing.id))
      .returning()
  } else {
    ;[customer] = await database
      .insert(schema.customers)
      .values({ arenaId, name: input.name, email: input.email.toLowerCase(), phone: input.phone ?? null, passwordHash: await hashPassword(input.password) })
      .returning()
  }
  const { token, ttl } = await createAuthSession("customer", customer.id, meta)
  await setSessionCookie("customer", token, ttl)
  return customer
}

export async function loginCustomer(arenaId: string, email: string, password: string, meta: RequestMeta) {
  const database = await db()
  const customer = await database.query.customers.findFirst({
    where: and(
      sql`lower(${schema.customers.email}) = ${email.toLowerCase()}`,
      eq(schema.customers.arenaId, arenaId),
      isNull(schema.customers.deletedAt)
    ),
  })
  const valid = await verifyPassword(password, customer?.passwordHash ?? "scrypt$16384$8$1$AAAA$AAAA")
  if (!customer || !valid) throw new AppError("INVALID_CREDENTIALS", "Incorrect email or password")
  if (!customer.isActive) throw new AppError("ACCOUNT_DISABLED", "This account has been disabled")
  const { token, ttl } = await createAuthSession("customer", customer.id, meta)
  await setSessionCookie("customer", token, ttl)
  await database.update(schema.customers).set({ lastLoginAt: new Date() }).where(eq(schema.customers.id, customer.id))
  return customer
}

export async function logoutCustomer(sessionId: string) {
  await revokeSession(sessionId)
  await clearSessionCookie("customer")
}
