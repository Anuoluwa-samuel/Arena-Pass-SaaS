import "server-only"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core"
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres"
import { drizzle as drizzlePglite } from "drizzle-orm/pglite"
import * as schema from "./schema"
import { env } from "@/server/env"
import { logger } from "@/server/observability/logger"

/**
 * One Postgres dialect, two drivers:
 *  - DATABASE_URL set  → node-postgres pool (staging / production)
 *  - DATABASE_URL unset → PGlite, an embedded Postgres persisted to disk.
 *
 * Both are cached on globalThis so Next.js hot reloads reuse the connection
 * instead of opening a new one on every file change.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>
export type Transaction = PgTransaction<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>
export type DbExecutor = Database | Transaction

/** Driver-agnostic access to raw `execute()` rows. */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[]
}

const globalForDb = globalThis as unknown as {
  __gameSlotsDb?: Promise<Database>
}

async function createDatabase(): Promise<Database> {
  if (env.DATABASE_URL) {
    const { Pool } = await import("pg")
    const pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      // Verify the server certificate (managed hosts like Neon have valid ones); a
      // non-verifying connection could be intercepted. Opt out only for self-signed dev servers.
      ssl: env.DATABASE_URL.includes("sslmode=require") ? { rejectUnauthorized: process.env.DATABASE_SSL_NO_VERIFY !== "1" } : undefined,
    })
    logger.info("db.connect", { driver: "postgres" })
    return drizzlePg(pool, { schema }) as unknown as Database
  }

  const { PGlite } = await import("@electric-sql/pglite")
  const dataDir = env.isTest ? undefined : env.PGLITE_DATA_DIR
  if (dataDir) {
    const { mkdir } = await import("node:fs/promises")
    await mkdir(dataDir, { recursive: true })
  }
  const client = dataDir ? new PGlite(dataDir) : new PGlite()
  await client.waitReady
  logger.info("db.connect", { driver: "pglite", dataDir: dataDir ?? "memory" })
  return drizzlePglite(client, { schema }) as unknown as Database
}

export function getDb(): Promise<Database> {
  if (!globalForDb.__gameSlotsDb) {
    globalForDb.__gameSlotsDb = createDatabase()
  }
  return globalForDb.__gameSlotsDb
}

/** Test helper: swap the shared instance (used by the integration suite). */
export function __setDbForTests(db: Database) {
  globalForDb.__gameSlotsDb = Promise.resolve(db)
}

export { schema }
