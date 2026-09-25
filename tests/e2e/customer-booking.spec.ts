import { test, expect, type Page } from "@playwright/test"

/**
 * Customer journey: Sessions → Session → Checkout → (mock) payment →
 * verification → digital ticket. Then staff validate that ticket once.
 */
async function bookFirstOpenSession(page: Page, email: string) {
  await page.goto("/sessions?filter=open")
  const firstCard = page.locator("a", { hasText: "Book a slot" }).first()
  await expect(firstCard).toBeVisible()
  await firstCard.click()
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  await page.getByRole("button", { name: /Book a slot/ }).click()
  await expect(page).toHaveURL(/\/checkout\//)

  await page.fill("#name", "Playwright Player")
  await page.fill("#email", email)
  await page.getByRole("button", { name: /Continue to payment/ }).click()

  // Mock provider page stands in for the hosted checkout.
  await expect(page).toHaveURL(/\/checkout\/mock-pay/)
  await page.getByRole("button", { name: "Pay successfully" }).click()

  await expect(page).toHaveURL(/\/tickets\/AP-\d{4}-\d{6}/, { timeout: 30_000 })
  // By role: Next's route announcer also contains the page title text.
  await expect(page.getByRole("heading", { name: "You're in!" })).toBeVisible()
  const ticketNumber = page.url().match(/AP-\d{4}-\d{6}/)![0]
  await expect(page.getByAltText(`QR code for ticket ${ticketNumber}`)).toBeVisible()
  return ticketNumber
}

test("customer books a slot, pays, receives a QR ticket; staff admit it once @mobile", async ({ page, browser }) => {
  test.setTimeout(180_000) // first-time route compilation in dev can be slow
  const email = `pw-${Date.now()}@example.com`
  const ticketNumber = await bookFirstOpenSession(page, email)

  // Staff validation in a separate session.
  const staff = await browser.newContext()
  const admin = await staff.newPage()
  await admin.goto("/admin/login")
  await admin.fill("#email", "admin@gameslots.local")
  await admin.fill("#password", "ChangeMe123!")
  await admin.getByRole("button", { name: "Sign in" }).click()
  await expect(admin).toHaveURL(/\/admin$/, { timeout: 60_000 })
  await admin.goto("/admin/validate")
  await admin.fill("#code", ticketNumber)
  await admin.getByRole("button", { name: "Admit", exact: true }).click()
  await expect(admin.getByText("VALID TICKET")).toBeVisible()

  await admin.fill("#code", ticketNumber)
  await admin.getByRole("button", { name: "Admit", exact: true }).click()
  await expect(admin.getByText("TICKET ALREADY USED")).toBeVisible()
  await staff.close()
})

test("a declined payment does not issue a ticket and can be retried", async ({ page }) => {
  await page.goto("/sessions?filter=open")
  await page.locator("a", { hasText: "Book a slot" }).first().click()
  await page.getByRole("button", { name: /Book a slot/ }).click()
  await page.fill("#name", "Declined Card")
  await page.fill("#email", `pw-declined-${Date.now()}@example.com`)
  await page.getByRole("button", { name: /Continue to payment/ }).click()
  await page.getByRole("button", { name: "Simulate a declined card" }).click()
  await expect(page.getByText("Payment not completed")).toBeVisible()
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible()
})
