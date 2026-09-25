/**
 * Prints the tenancy shape of the connected database: roles, organizations,
 * arenas, memberships and every row that still has no tenant.
 *
 * Used to verify a tenancy migration before and after it runs, and to check
 * that a database is ready for the NOT NULL constraints that come later.
 *
 *   npx tsx --conditions=react-server scripts/dev/tenancy-report.ts
 *
 * Connects with DATABASE_URL when set, otherwise the local PGlite directory.
 * Read-only: it never writes.
 */
import { sql } from "drizzle-orm"
import { getDb } from "@/server/db/client"

const QUERIES: Array<[string, string]> = [
  ["roles", "select key, scope, name from roles order by scope, key"],
  [
    "users",
    `select u.email, r.key as role_id_key, pr.key as platform_role, u.arena_id is not null as legacy_arena
       from users u
       join roles r on r.id = u.role_id
       left join roles pr on pr.id = u.platform_role_id
      order by u.email`,
  ],
  ["organizations", "select slug, name, status from organizations order by slug"],
  ["arenas", "select slug, name, status, onboarding_step, organization_id is not null as has_org from arenas order by slug"],
  [
    "memberships",
    `select a.slug as arena, u.email, r.key as role, m.status
       from arena_memberships m
       join arenas a on a.id = m.arena_id
       join users u on u.id = m.user_id
       join roles r on r.id = m.role_id
      order by a.slug, u.email`,
  ],
  [
    "rows without a tenant",
    `select 'teams' as t, count(*) from teams where arena_id is null
      union all select 'session_slots', count(*) from session_slots where arena_id is null
      union all select 'waitlist_entries', count(*) from waitlist_entries where arena_id is null
      union all select 'ticket_validations', count(*) from ticket_validations where arena_id is null
      union all select 'media', count(*) from media where arena_id is null
      union all select 'cms_pages', count(*) from cms_pages where arena_id is null
      union all select 'cms_services', count(*) from cms_services where arena_id is null
      union all select 'faqs', count(*) from faqs where arena_id is null
      union all select 'announcements', count(*) from announcements where arena_id is null
      union all select 'banners', count(*) from banners where arena_id is null
      union all select 'notifications', count(*) from notifications where arena_id is null
      union all select 'audit_logs', count(*) from audit_logs where arena_id is null
      union all select 'customers', count(*) from customers where arena_id is null`,
  ],
  [
    "volumes",
    `select (select count(*) from sessions) as sessions,
            (select count(*) from bookings) as bookings,
            (select count(*) from tickets) as tickets,
            (select count(*) from payments) as payments,
            (select count(*) from customers) as customers`,
  ],
  [
    "cross-tenant leaks",
    `select 'booking vs session' as check, count(*) as rows from bookings b join sessions s on s.id = b.session_id where s.arena_id <> b.arena_id
      union all select 'ticket vs booking', count(*) from tickets t join bookings b on b.id = t.booking_id where b.arena_id <> t.arena_id
      union all select 'payment vs booking', count(*) from payments p join bookings b on b.id = p.booking_id where b.arena_id <> p.arena_id
      union all select 'slot vs session', count(*) from session_slots sl join sessions s on s.id = sl.session_id where sl.arena_id is not null and sl.arena_id <> s.arena_id`,
  ],
]

async function main() {
  const database = (await getDb()) as unknown as { execute: (q: unknown) => Promise<{ rows?: unknown[] }> }
  for (const [label, query] of QUERIES) {
    // Tolerated so the same script can be run against a database that has not
    // been migrated yet: a missing table or column is reported, not fatal.
    try {
      const result = await database.execute(sql.raw(query))
      const rows = result.rows ?? []
      console.log(`\n== ${label} (${rows.length}) ==`)
      for (const row of rows) console.log("  ", JSON.stringify(row))
    } catch (err) {
      console.log(`\n== ${label} — unavailable: ${(err as Error).message.split("\n")[0]}`)
    }
  }
  console.log()
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
