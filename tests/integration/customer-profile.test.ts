import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { eq } from "drizzle-orm"
import { schema } from "@/server/db"
import { createTestDb } from "../helpers/db"
import { getArena } from "../helpers/fixtures"
import { hashPassword, verifyPassword } from "@/server/auth/password"
import { createAuthSession } from "@/server/auth/session"
import { changeCustomerPassword, getCustomerProfile, updateCustomerProfile } from "@/server/services/profile"
import { profileSchema } from "@/lib/validation/profile"

let ctx: Awaited<ReturnType<typeof createTestDb>>
/** Customer identity is per arena; these all act on the seeded one. */
let arena: Awaited<ReturnType<typeof getArena>>
beforeAll(async () => {
  ctx = await createTestDb()
  arena = await getArena(ctx.db)
})
afterAll(async () => {
  await ctx.client.close()
})

async function makeCustomer(email: string, password: string | null = "OldPassword123") {
  const [row] = await ctx.db.insert(schema.customers).values({ arenaId: arena.id, name: "Profile Tester", email, passwordHash: password ? await hashPassword(password) : null }).returning()
  return row
}
const save = (id: string, input: Record<string, unknown>) => updateCustomerProfile(id, profileSchema.parse({ name: "Profile Tester", ...input }))

describe("customer profile", () => {
  it("saves every field and never exposes the password hash", async () => {
    const c = await makeCustomer("full@example.com")
    const out = await save(c.id, { username: "Striker_9", phone: "+2348000000000", dateOfBirth: "1998-04-12", gender: "male", city: "Lekki", preferredPosition: "forward", skillLevel: "intermediate", emergencyContactName: "Kemi", emergencyContactPhone: "+2348111111111" })
    expect(out).toMatchObject({ username: "striker_9", dateOfBirth: "1998-04-12", preferredPosition: "forward", emergencyContactPhone: "+2348111111111", hasPassword: true })
    expect(out).not.toHaveProperty("passwordHash")
    expect(await getCustomerProfile(c.id)).toEqual(out)
  })

  it("clears fields that are blanked", async () => {
    const c = await makeCustomer("clear@example.com")
    await save(c.id, { city: "Yaba", username: "clearme" })
    const out = await save(c.id, { city: "", username: "" })
    expect(out.city).toBeNull()
    expect(out.username).toBeNull()
  })

  it("keeps usernames unique regardless of case, and lets you keep your own", async () => {
    const a = await makeCustomer("a@example.com")
    const b = await makeCustomer("b@example.com")
    await save(a.id, { username: "goalmachine" })
    await expect(save(b.id, { username: "GoalMachine" })).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: [{ path: "username" }] })
    await expect(save(a.id, { username: "goalmachine", city: "Ikeja" })).resolves.toMatchObject({ city: "Ikeja" })
  })

  it("refuses to edit a deactivated account", async () => {
    const c = await makeCustomer("off@example.com")
    await ctx.db.update(schema.customers).set({ isActive: false }).where(eq(schema.customers.id, c.id))
    await expect(save(c.id, { city: "Ajah" })).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
})

describe("customer password change", () => {
  it("requires the current password and rejects reusing it", async () => {
    const c = await makeCustomer("pw@example.com")
    const { session } = await createAuthSession("customer", c.id, {})
    await expect(changeCustomerPassword(c.id, session.id, { currentPassword: "wrong-password", newPassword: "NewPassword456" })).rejects.toMatchObject({ details: [{ path: "currentPassword" }] })
    await expect(changeCustomerPassword(c.id, session.id, { newPassword: "NewPassword456" })).rejects.toMatchObject({ details: [{ path: "currentPassword" }] })
    await expect(changeCustomerPassword(c.id, session.id, { currentPassword: "OldPassword123", newPassword: "OldPassword123" })).rejects.toMatchObject({ details: [{ path: "newPassword" }] })
  })

  it("changes it, keeps this device signed in and signs out the others", async () => {
    const c = await makeCustomer("devices@example.com")
    const here = await createAuthSession("customer", c.id, {})
    const phone = await createAuthSession("customer", c.id, {})
    const laptop = await createAuthSession("customer", c.id, {})
    const result = await changeCustomerPassword(c.id, here.session.id, { currentPassword: "OldPassword123", newPassword: "NewPassword456" })
    expect(result.hadPassword).toBe(true)

    const stored = (await ctx.db.query.customers.findFirst({ where: eq(schema.customers.id, c.id) }))!
    expect(await verifyPassword("NewPassword456", stored.passwordHash)).toBe(true)
    const sessions = await ctx.db.query.authSessions.findMany({ where: eq(schema.authSessions.principalId, c.id) })
    const byId = Object.fromEntries(sessions.map((s) => [s.id, s.revokedAt]))
    expect(byId[here.session.id]).toBeNull()
    expect(byId[phone.session.id]).not.toBeNull()
    expect(byId[laptop.session.id]).not.toBeNull()
  })

  it("lets a Google-only account set its first password without a current one", async () => {
    const c = await makeCustomer("google-only@example.com", null)
    const { session } = await createAuthSession("customer", c.id, {})
    const result = await changeCustomerPassword(c.id, session.id, { newPassword: "FirstPassword789" })
    expect(result.hadPassword).toBe(false)
    const stored = (await ctx.db.query.customers.findFirst({ where: eq(schema.customers.id, c.id) }))!
    expect(await verifyPassword("FirstPassword789", stored.passwordHash)).toBe(true)
    expect((await getCustomerProfile(c.id)).hasPassword).toBe(true)
  })
})
