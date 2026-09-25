import { test, expect } from "@playwright/test"
import { generateSession } from "./session-data"

/** Admin journey: sign in → create session with custom capacity → publish → see it on the public site. */
test("admin creates, configures and publishes a session", async ({ page }) => {
  await page.goto("/admin/login")
  await page.fill("#email", "admin@gameslots.local")
  await page.fill("#password", "ChangeMe123!")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/admin$/, { timeout: 60_000 }) // sign-in + first admin compile is slow in dev under parallel workers
  await expect(page.getByText("Today's sales")).toBeVisible()

  // Varied, realistic data per run; avoid titles already on the site so the card lookup is unambiguous.
  const existing = (await (await page.request.get("/api/sessions?pageSize=100")).json()).data.map((x: { title: string }) => x.title)
  const s = generateSession(existing)

  await page.goto("/admin/sessions/new")
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  await page.fill("#title", s.title)
  await page.fill("#venue", s.venue)
  await page.fill("#startsAt", local(s.start))
  await page.fill("#endsAt", local(s.end))
  await page.fill("#bookingOpensAt", local(new Date(Date.now() - 60_000)))
  await page.fill("#bookingDeadline", local(new Date(s.start.getTime() - 3_600_000)))
  await page.fill("#teamsCount", String(s.teams))
  await page.fill("#playersPerTeam", String(s.players))
  await expect(page.locator("p", { hasText: "players" }).filter({ hasText: new RegExp(`^${s.capacity}\\s`) })).toBeVisible() // computed capacity
  await page.fill("#price", String(s.price))
  await page.getByRole("button", { name: "Publish session" }).click()

  await expect(page).toHaveURL(/\/admin\/sessions\/[0-9a-f-]+$/)
  await expect(page.getByRole("heading", { name: s.title, exact: true })).toBeVisible()
  await expect(page.getByText(`0/${s.capacity}`)).toBeVisible()

  await page.goto("/sessions")
  // Scope to this run's card by its unique title.
  const card = page.locator('[data-slot="card"]', { has: page.getByRole("heading", { name: s.title, exact: true }) })
  await expect(card).toBeVisible()
  await expect(card.getByText(`${s.teams} teams × ${s.players} players`)).toBeVisible()
})

test("staff role cannot open finance pages", async ({ page }) => {
  await page.goto("/admin/login")
  await page.fill("#email", "sam.staff@gameslots.local")
  await page.fill("#password", "ChangeMe123!")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/admin$/, { timeout: 60_000 }) // sign-in + first admin compile is slow in dev under parallel workers
  await expect(page.getByRole("link", { name: "Payments" })).toHaveCount(0)
  const res = await page.request.get("/api/admin/payments")
  expect(res.status()).toBe(403)
  const body = await res.json()
  expect(body.code).toBe("FORBIDDEN")
})
