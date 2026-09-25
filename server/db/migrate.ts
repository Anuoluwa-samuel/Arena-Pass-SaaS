import "server-only"
import path from "node:path"
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator"
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator"
import { env } from "@/server/env"
import { getDb, type Database } from "./client"
import { logger } from "@/server/observability/logger"

const migrationsFolder = path.join(process.cwd(), "server", "db", "migrations")

const globalForMigrate = globalThis as unknown as { __gameSlotsMigrated?: Promise<void> }

/** Apply pending SQL migrations. Safe to call repeatedly; runs once per process. */
export function runMigrations(db?: Database): Promise<void> {
  if (!globalForMigrate.__gameSlotsMigrated) {
    globalForMigrate.__gameSlotsMigrated = (async () => {
      const database = db ?? (await getDb())
      if (env.DATABASE_URL) {
        await migratePg(database as any, { migrationsFolder })
      } else {
        await migratePglite(database as any, { migrationsFolder })
      }
      logger.info("db.migrated")
    })()
  }
  return globalForMigrate.__gameSlotsMigrated
}
