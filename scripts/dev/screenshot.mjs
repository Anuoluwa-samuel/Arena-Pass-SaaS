import { chromium } from "@playwright/test"
const [,, ...args] = process.argv
// Defaults inside the repo (gitignored) so this works on any machine; set
// SHOT_DIR to put the images somewhere else.
const out = process.env.SHOT_DIR ?? ".shots"
// --light / --dark drive `prefers-color-scheme` so the default "system" theme resolves.
const scheme = args.includes("--dark") ? "dark" : args.includes("--light") ? "light" : undefined
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: args.includes("--mobile") ? 390 : 1360, height: args.includes("--mobile") ? 844 : 900 }, deviceScaleFactor: 1, colorScheme: scheme })
const page = await ctx.newPage()
const errors = []
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message))
if (args.includes("--admin")) {
  await page.goto("http://localhost:4000/admin/login", { waitUntil: "networkidle" })
  await page.fill("#email", "admin@arenapass.local"); await page.fill("#password", "ChangeMe123!")
  await page.click("button[type=submit]"); await page.waitForURL(/\/admin(?!\/login)/, { timeout: 60000 })
}
for (const url of args.filter((a) => a.startsWith("/"))) {
  await page.goto("http://localhost:4000" + url, { waitUntil: "networkidle", timeout: 120000 })
  await page.waitForTimeout(1200)
  const name = (url.replace(/[^a-z0-9]+/gi, "_") || "home") + (args.includes("--mobile") ? "_m" : "") + (scheme ? "_" + scheme : "")
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: !args.includes("--fold") })
  console.log("shot", name, page.url())
}
if (errors.length) console.log("CONSOLE ERRORS:\n" + errors.slice(0, 15).join("\n"))
await browser.close()
