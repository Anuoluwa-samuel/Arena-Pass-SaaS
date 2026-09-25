/**
 * Renames the old brand out of an existing development database.
 *
 * The code no longer mentions Arena Pass anywhere, but a database seeded
 * before the rename still holds it: the first arena's name, its organization,
 * its site name, its staff email addresses and the CMS copy that was written
 * with the old name in it.
 *
 * A fresh `npm run db:reset` produces all of this correctly and is the simpler
 * path. This exists for a database whose bookings, tickets and payments are
 * worth keeping — it renames in place and touches nothing else.
 *
 * PGlite is single-process: stop the dev server before running this, or it
 * will fail to take the lock.
 *
 *   npx tsx --conditions=react-server scripts/dev/rebrand-demo-arena.ts
 */
import { eq, sql } from "drizzle-orm"
import { db, schema } from "@/server/db"

/** The first arena was named after the product. As one tenant among others it needs a venue's name. */
const ARENA_NAME = "Ikeja City Arena"
const ORGANIZATION_NAME = "Ikeja City Sports"
const OLD_EMAIL_DOMAIN = "arenapass.local"
const NEW_EMAIL_DOMAIN = "ikeja.local"
/** Every spelling of the old brand that appears in seeded text. */
const TEXT_REPLACEMENTS: readonly (readonly [string, string])[] = [
  ["Arena Pass", ARENA_NAME],
  ["ArenaPass", ARENA_NAME],
  ["arenapass", "ikeja"],
]

function rewrite(value: string): string {
  return TEXT_REPLACEMENTS.reduce((acc, [from, to]) => acc.split(from).join(to), value)
}

async function main() {
  const database = await db()

  const arena = await database.query.arenas.findFirst({ where: eq(schema.arenas.slug, "main") })
  if (!arena) {
    console.log("No arena with slug 'main'. Nothing to rename.")
    return
  }

  await database.update(schema.arenas).set({ name: ARENA_NAME }).where(eq(schema.arenas.id, arena.id))
  if (arena.organizationId) {
    await database
      .update(schema.organizations)
      .set({ name: ORGANIZATION_NAME })
      .where(eq(schema.organizations.id, arena.organizationId))
  }
  console.log(`arena  → ${ARENA_NAME}`)

  // Settings are stored as JSON values keyed per arena.
  const settings = await database.query.systemSettings.findMany({ where: eq(schema.systemSettings.arenaId, arena.id) })
  for (const row of settings) {
    if (typeof row.value !== "string") continue
    const next = rewrite(row.value)
    if (next !== row.value) {
      await database.update(schema.systemSettings).set({ value: next }).where(eq(schema.systemSettings.id, row.id))
      console.log(`setting ${row.key} → ${next}`)
    }
  }

  // Staff addresses. Customers are untouched: they are on example.com and
  // never carried the brand.
  const users = await database.query.users.findMany()
  let renamedUsers = 0
  for (const user of users) {
    if (!user.email.endsWith(`@${OLD_EMAIL_DOMAIN}`)) continue
    await database
      .update(schema.users)
      .set({ email: user.email.replace(`@${OLD_EMAIL_DOMAIN}`, `@${NEW_EMAIL_DOMAIN}`) })
      .where(eq(schema.users.id, user.id))
    renamedUsers++
  }
  console.log(`staff emails → @${NEW_EMAIL_DOMAIN} (${renamedUsers})`)

  // CMS copy. The page documents are jsonb and the collections are plain text,
  // so both are rewritten as text and the documents cast back — nothing here
  // has to know the shape of each document.
  const jsonDocuments: [string, string[]][] = [["cms_pages", ["draft", "published"]]]
  const plainText: [string, string[]][] = [
    ["cms_services", ["title", "description"]],
    ["faqs", ["question", "answer"]],
    ["announcements", ["title", "content"]],
    ["banners", ["title", "subtitle", "link_label"]],
  ]

  for (const [table, columns, isJson] of [
    ...jsonDocuments.map(([t, c]) => [t, c, true] as const),
    ...plainText.map(([t, c]) => [t, c, false] as const),
  ]) {
    for (const column of columns) {
      for (const [from, to] of TEXT_REPLACEMENTS) {
        // Identifiers are constants in this file; only the values are
        // parameters, which is the half that could come from anywhere.
        const target = sql.raw(`"${table}"."${column}"`)
        const assign = sql.raw(`"${column}"`)
        await database.execute(
          isJson
            ? sql`UPDATE ${sql.raw(`"${table}"`)} SET ${assign} = replace(${target}::text, ${from}, ${to})::jsonb
                  WHERE "arena_id" = ${arena.id} AND ${target}::text LIKE ${`%${from}%`}`
            : sql`UPDATE ${sql.raw(`"${table}"`)} SET ${assign} = replace(${target}, ${from}, ${to})
                  WHERE "arena_id" = ${arena.id} AND ${target} LIKE ${`%${from}%`}`
        )
      }
    }
  }
  console.log("cms copy → rewritten")

  console.log("\nDone. Bookings, tickets and payments were not touched.")
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  }
)
