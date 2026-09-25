import "server-only"
import { and, eq, type SQL } from "drizzle-orm"
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core"
import { db } from "./index"
import { notFound } from "@/server/http/errors"
import { assertArenaId } from "@/server/tenant/guards"

/**
 * Tenant-scoped database access.
 *
 * The point of this module is to make the scoped query the *short* one. A
 * service that holds an `ArenaScope` writes `scope.owns(tickets, eq(...))`
 * instead of assembling the arena filter by hand, and `scope.require(tickets,
 * id)` instead of `findFirst({ where: eq(tickets.id, id) })` — so forgetting
 * the tenant filter takes more typing than remembering it.
 *
 * Reads that genuinely span tenants (authentication, tenant resolution,
 * platform administration, cron sweeps) do not belong here. They use the
 * plain `db()` handle and say why.
 */

/** Any table that carries its own `arena_id`. */
export type TenantTable = PgTable & { id: AnyPgColumn; arenaId: AnyPgColumn }

export interface ArenaScope {
  readonly arenaId: string

  /**
   * Conditions for a tenant-owned table, always anded with this arena. Use it
   * wherever a `where` is built: the arena filter can then only be left out
   * by not using the scope at all, which is visible in review.
   */
  owns(table: TenantTable, ...conditions: (SQL | undefined)[]): SQL

  /**
   * One row of a tenant-owned table by id, scoped to this arena.
   *
   * A row belonging to another arena is reported as *not found*, never as
   * forbidden — "forbidden" would confirm the id exists, which is how an
   * attacker enumerates another arena's bookings.
   */
  require<T extends TenantTable>(table: T, id: string, what?: string): Promise<T["$inferSelect"]>

  /** Same lookup, returning undefined instead of throwing. */
  find<T extends TenantTable>(table: T, id: string): Promise<T["$inferSelect"] | undefined>
}

export function forArena(arenaId: string): ArenaScope {
  const scoped = assertArenaId(arenaId, "forArena")

  return {
    arenaId: scoped,

    owns(table, ...conditions) {
      return and(eq(table.arenaId, scoped), ...conditions.filter(Boolean))!
    },

    async require(table, id, what = "Resource") {
      const row = await this.find(table, id)
      if (!row) throw notFound(what)
      return row
    },

    async find(table, id) {
      const database = await db()
      // Drizzle's `from()` cannot be expressed over a generic table, so the
      // builder is untyped here and the public signature restores the row
      // type the table already declares.
      const builder = database.select() as unknown as {
        from: (t: TenantTable) => { where: (c: SQL) => { limit: (n: number) => Promise<unknown[]> } }
      }
      const rows = await builder
        .from(table)
        .where(and(eq(table.id, id), eq(table.arenaId, scoped))!)
        .limit(1)
      return rows[0] as never
    },
  }
}
