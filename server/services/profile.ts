import "server-only"
import { and, eq, ne, sql } from "drizzle-orm"
import { db, schema } from "@/server/db"
import { AppError, isUniqueViolation, notFound } from "@/server/http/errors"
import { hashPassword, verifyPassword } from "@/server/auth/password"
import { recordAudit } from "./audit"
import type { ProfileInput } from "@/lib/validation/profile"

interface RequestMeta {
  ip?: string | null
}

/** Fields a customer may see and edit about themselves. Never includes the password hash. */
export function toProfile(c: schema.Customer) {
  return {
    name: c.name,
    email: c.email,
    username: c.username,
    phone: c.phone,
    dateOfBirth: c.dateOfBirth,
    gender: c.gender,
    city: c.city,
    preferredPosition: c.preferredPosition,
    skillLevel: c.skillLevel,
    emergencyContactName: c.emergencyContactName,
    emergencyContactPhone: c.emergencyContactPhone,
    hasPassword: Boolean(c.passwordHash),
    usesGoogle: Boolean(c.googleSub),
  }
}
export type CustomerProfile = ReturnType<typeof toProfile>

const usernameTaken = () => new AppError("VALIDATION_ERROR", "That username is already taken", { details: [{ path: "username", message: "That username is already taken" }] })

async function loadCustomer(id: string) {
  const database = await db()
  const customer = await database.query.customers.findFirst({ where: eq(schema.customers.id, id) })
  if (!customer || customer.deletedAt || !customer.isActive) throw notFound("Account")
  return customer
}

export async function getCustomerProfile(customerId: string) {
  return toProfile(await loadCustomer(customerId))
}

export async function updateCustomerProfile(customerId: string, input: ProfileInput, meta: RequestMeta = {}) {
  const database = await db()
  const existing = await loadCustomer(customerId)
  const username = input.username ?? null
  if (username && username !== existing.username) {
    // Handles are unique within a storefront, not across the platform.
    const clash = await database.query.customers.findFirst({
      where: and(sql`lower(${schema.customers.username}) = ${username}`, eq(schema.customers.arenaId, existing.arenaId!), ne(schema.customers.id, customerId)),
    })
    if (clash) throw usernameTaken()
  }
  try {
    const [row] = await database
      .update(schema.customers)
      .set({
        name: input.name,
        username,
        phone: input.phone ?? null,
        dateOfBirth: input.dateOfBirth ?? null,
        gender: input.gender ?? null,
        city: input.city ?? null,
        preferredPosition: input.preferredPosition ?? null,
        skillLevel: input.skillLevel ?? null,
        emergencyContactName: input.emergencyContactName ?? null,
        emergencyContactPhone: input.emergencyContactPhone ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.customers.id, customerId))
      .returning()
    await recordAudit({ type: "customer", id: customerId, name: row.name, ip: meta.ip }, { action: "customer.profile_update", description: `${row.name} updated their profile`, entityType: "customer", entityId: customerId, arenaId: row.arenaId })
    return toProfile(row)
  } catch (err) {
    // Two customers claiming the same free username at once: the unique index decides.
    if (isUniqueViolation(err, "customers_username_lower_idx")) throw usernameTaken()
    throw err
  }
}

/**
 * Sets a new password. Accounts that already have one must prove the current
 * password; Google-only and guest accounts set their first. Every other session
 * is signed out; the session making the change stays signed in.
 */
export async function changeCustomerPassword(
  customerId: string,
  currentSessionId: string,
  input: { currentPassword?: string; newPassword: string },
  meta: RequestMeta = {}
) {
  const database = await db()
  const customer = await loadCustomer(customerId)
  if (customer.passwordHash) {
    const ok = input.currentPassword ? await verifyPassword(input.currentPassword, customer.passwordHash) : false
    if (!ok) throw new AppError("VALIDATION_ERROR", "Your current password is incorrect", { details: [{ path: "currentPassword", message: "Your current password is incorrect" }] })
    if (await verifyPassword(input.newPassword, customer.passwordHash)) {
      throw new AppError("VALIDATION_ERROR", "Choose a password you haven't used here", { details: [{ path: "newPassword", message: "That's your current password — choose a new one" }] })
    }
  }
  const now = new Date()
  await database.update(schema.customers).set({ passwordHash: await hashPassword(input.newPassword), updatedAt: now }).where(eq(schema.customers.id, customerId))
  await database
    .update(schema.authSessions)
    .set({ revokedAt: now })
    .where(and(eq(schema.authSessions.principalType, "customer"), eq(schema.authSessions.principalId, customerId), ne(schema.authSessions.id, currentSessionId), sql`${schema.authSessions.revokedAt} is null`))
  await recordAudit({ type: "customer", id: customerId, name: customer.name, ip: meta.ip }, { action: customer.passwordHash ? "auth.password_change" : "auth.password_set", description: `${customer.name} ${customer.passwordHash ? "changed" : "set"} their password`, entityType: "customer", entityId: customerId, arenaId: customer.arenaId })
  return { hadPassword: Boolean(customer.passwordHash) }
}
