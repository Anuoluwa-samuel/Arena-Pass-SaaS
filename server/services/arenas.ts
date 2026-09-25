import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import { db, schema } from "@/server/db"
import { notFound } from "@/server/http/errors"

/**
 * The seeded `main` arena.
 *
 * @deprecated Not a tenant resolver. Public requests resolve their arena from
 * the hostname (`server/tenant`), and admin requests from the caller's
 * membership. This remains only for the development seed and the pre-tenancy
 * admin fallback, which the authorization work removes. Calling it from a
 * request path would silently serve one arena's data on another's address.
 */
export async function getDefaultArena() {
  const database = await db()
  const arena =
    (await database.query.arenas.findFirst({ where: and(eq(schema.arenas.slug, "main"), isNull(schema.arenas.deletedAt)) })) ??
    (await database.query.arenas.findFirst({ where: and(eq(schema.arenas.status, "ACTIVE"), isNull(schema.arenas.deletedAt)) }))
  if (!arena) throw notFound("Arena")
  return arena
}

export async function listArenas() {
  const database = await db()
  return database.query.arenas.findMany({ where: isNull(schema.arenas.deletedAt), orderBy: (a, { asc }) => [asc(a.name)] })
}

export async function getArenaById(id: string) {
  const database = await db()
  const arena = await database.query.arenas.findFirst({ where: and(eq(schema.arenas.id, id), isNull(schema.arenas.deletedAt)) })
  if (!arena) throw notFound("Arena")
  return arena
}
