/**
 * Attributes customers that still have no arena to the oldest arena.
 *
 *   npx tsx --conditions=react-server scripts/dev/attribute-orphan-customers.ts [--apply]
 *
 * The tenancy migration deliberately refuses to guess which arena a customer
 * belongs to when several exist, so accounts that never booked are left with
 * `arena_id IS NULL` and block the NOT NULL constraint. This is the remedy for
 * the common case: accounts created before a second arena existed can only
 * have belonged to the first one.
 *
 * Prints what it would do unless `--apply` is passed, and never touches a
 * customer that has a booking or a ticket — those were attributed from the
 * booking itself and a disagreement here would mean something is wrong.
 */
import { asc, isNull, sql } from "drizzle-orm"
import { db, schema } from "@/server/db"
import { env } from "@/server/env"

async function main() {
  const apply = process.argv.includes("--apply")
  const database = await db()

  const arenas = await database.query.arenas.findMany({
    where: isNull(schema.arenas.deletedAt),
    orderBy: [asc(schema.arenas.createdAt)],
  })
  if (arenas.length === 0) throw new Error("No arenas exist")
  const oldest = arenas[0]

  const orphans = await database.query.customers.findMany({ where: isNull(schema.customers.arenaId) })
  if (orphans.length === 0) {
    console.log("Every customer already belongs to an arena.")
    return
  }

  const withActivity = await database.execute(sql`
    select count(*)::int as n from customers c
    where c.arena_id is null
      and (exists (select 1 from bookings b where b.customer_id = c.id)
        or exists (select 1 from tickets t where t.customer_id = c.id))
  `)
  const active = Number((withActivity as unknown as { rows: { n: number }[] }).rows[0].n)
  if (active > 0) {
    throw new Error(`${active} unattributed customers have bookings or tickets — attribute those from their booking, not by age`)
  }

  console.log(`${orphans.length} customer(s) with no arena, none of which has ever booked:`)
  for (const c of orphans) console.log(`  ${c.email}  created ${c.createdAt.toISOString().slice(0, 10)}`)
  console.log(`\nWould attribute them to the oldest arena: ${oldest.name} (${oldest.slug})`)
  if (arenas.length > 1) {
    console.log(`Created ${arenas[1].createdAt.toISOString().slice(0, 10)}: the next arena, ${arenas[1].slug}.`)
  }

  if (!apply) {
    console.log("\nNothing changed. Re-run with --apply to write.")
    return
  }
  if (env.isProd) throw new Error("Refusing to guess customer ownership in production — attribute these by hand")

  await database
    .update(schema.customers)
    .set({ arenaId: oldest.id, updatedAt: new Date() })
    .where(isNull(schema.customers.arenaId))
  console.log(`\nAttributed ${orphans.length} customer(s) to ${oldest.slug}.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
