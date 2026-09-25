import "server-only"
import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { forArena } from "@/server/db/scoped"
import { db, schema } from "@/server/db"
import { env } from "@/server/env"
import { AppError, notFound } from "@/server/http/errors"
import { getStorage } from "@/server/storage"
import { recordAudit, type AuditActor } from "./audit"

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
}

const MAGIC: Array<{ type: string; bytes: number[]; offset?: number }> = [
  { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { type: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { type: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { type: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] },
]

/**
 * Anything in an SVG that can execute, fetch, or navigate.
 *
 * An SVG is a document, not a picture: it can carry scripts, event handlers,
 * external references and embedded frames. Served from the arena's own origin
 * — which is where its admins and customers are signed in — that is stored
 * XSS with a session-stealing payload.
 *
 * Suspicious files are **rejected, not cleaned**. A sanitiser is a list of
 * things someone thought of; every few years the browser adds another. An
 * operator who needs a logo can upload a PNG.
 */
const SVG_FORBIDDEN: Array<{ pattern: RegExp; what: string }> = [
  { pattern: /<\s*script/i, what: "a <script> element" },
  { pattern: /<\s*(foreignObject|iframe|embed|object|audio|video|animate|set|handler)\b/i, what: "an element that can execute or embed content" },
  // `on…=` attributes: onload, onclick, onbegin, onerror…
  { pattern: /\son[a-z]+\s*=/i, what: "an event handler attribute" },
  { pattern: /javascript\s*:/i, what: "a javascript: URL" },
  { pattern: /data\s*:\s*text\/html/i, what: "an embedded HTML document" },
  // External references pull resources from elsewhere when the image renders.
  { pattern: /(href|xlink:href)\s*=\s*["']?\s*(https?:)?\/\//i, what: "an external reference" },
  { pattern: /<!ENTITY/i, what: "an XML entity declaration" },
  { pattern: /<!DOCTYPE[^>]+\[/i, what: "an internal DTD subset" },
]

export function inspectSvg(source: string): { ok: true } | { ok: false; what: string } {
  const head = source.trimStart()
  if (!/^(<\?xml|<svg|<!--)/i.test(head)) return { ok: false, what: "something that is not an SVG document" }
  for (const { pattern, what } of SVG_FORBIDDEN) {
    if (pattern.test(source)) return { ok: false, what }
  }
  return { ok: true }
}

/** Sniff the real content type; never trust the client-supplied one alone. */
function detectType(buf: Buffer, declared: string) {
  for (const m of MAGIC) {
    if (m.bytes.every((b, i) => buf[(m.offset ?? 0) + i] === b)) return m.type
  }
  if (declared === "image/svg+xml") return "image/svg+xml"
  return null
}

function readDimensions(buf: Buffer, type: string): { width: number; height: number } | null {
  try {
    if (type === "image/png" && buf.length >= 24) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    if (type === "image/gif" && buf.length >= 10) return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
    if (type === "image/jpeg") {
      let i = 2
      while (i < buf.length) {
        if (buf[i] !== 0xff) return null
        const marker = buf[i + 1]
        const len = buf.readUInt16BE(i + 2)
        if (marker >= 0xc0 && marker <= 0xc3) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
        i += 2 + len
      }
    }
  } catch {
    return null
  }
  return null
}

export async function uploadMedia(
  file: { buffer: Buffer; originalName: string; mimeType: string },
  opts: { arenaId: string; folder?: string; altText?: string; actor: AuditActor }
) {
  if (file.buffer.length === 0) throw new AppError("VALIDATION_ERROR", "File is empty")
  if (file.buffer.length > env.MAX_UPLOAD_BYTES) throw new AppError("VALIDATION_ERROR", `File exceeds the ${Math.round(env.MAX_UPLOAD_BYTES / 1024 / 1024)}MB limit`)
  const type = detectType(file.buffer, file.mimeType)
  if (!type || !(type in ALLOWED_TYPES)) throw new AppError("VALIDATION_ERROR", "Only JPEG, PNG, WebP, GIF and SVG images are allowed")
  if (type === "image/svg+xml") {
    const verdict = inspectSvg(file.buffer.toString("utf8"))
    if (!verdict.ok) {
      throw new AppError("VALIDATION_ERROR", `This SVG contains ${verdict.what}, which cannot be served safely. Upload a PNG or WebP instead.`)
    }
  }

  const folder = (opts.folder ?? "general").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40) || "general"
  const filename = `${randomUUID()}.${ALLOWED_TYPES[type]}`
  // The arena leads the storage key, so one tenant's uploads are a separate
  // prefix in the bucket and the name is generated rather than taken from the
  // upload — the original filename never reaches the filesystem.
  const key = `${opts.arenaId}/${folder}/${filename}`
  const { url } = await getStorage().put(key, file.buffer, type)
  const dims = readDimensions(file.buffer, type)

  const database = await db()
  const [row] = await database
    .insert(schema.media)
    .values({
      arenaId: opts.arenaId,
      storageKey: key,
      url,
      filename,
      originalName: file.originalName.slice(0, 200),
      mimeType: type,
      sizeBytes: file.buffer.length,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      altText: opts.altText ?? null,
      folder,
      uploadedBy: opts.actor.type === "user" ? opts.actor.id ?? null : null,
    })
    .returning()
  await recordAudit(opts.actor, { action: "media.upload", entityType: "media", entityId: row.id, arenaId: opts.arenaId, description: `Uploaded ${row.originalName}` })
  return row
}

export async function listMedia(arenaId: string, opts: { folder?: string; q?: string; page?: number; pageSize?: number } = {}) {
  const scope = forArena(arenaId)
  const database = await db()
  const page = opts.page ?? 1
  const pageSize = opts.pageSize ?? 40
  const where: SQL[] = [eq(schema.media.arenaId, scope.arenaId), isNull(schema.media.deletedAt)]
  if (opts.folder && opts.folder !== "all") where.push(eq(schema.media.folder, opts.folder))
  if (opts.q) where.push(or(ilike(schema.media.originalName, `%${opts.q}%`), ilike(schema.media.altText, `%${opts.q}%`))!)
  const condition = and(...where)
  const [{ count }] = await database.select({ count: sql<number>`count(*)::int` }).from(schema.media).where(condition)
  const items = await database.select().from(schema.media).where(condition).orderBy(desc(schema.media.createdAt)).limit(pageSize).offset((page - 1) * pageSize)
  const folders = await database.selectDistinct({ folder: schema.media.folder }).from(schema.media).where(scope.owns(schema.media, isNull(schema.media.deletedAt)))
  return { items, folders: folders.map((f) => f.folder), meta: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) } }
}

export async function getMedia(arenaId: string, id: string) {
  const scope = forArena(arenaId)
  const database = await db()
  const row = await database.query.media.findFirst({ where: scope.owns(schema.media, eq(schema.media.id, id), isNull(schema.media.deletedAt)) })
  if (!row) throw notFound("Media")
  return row
}

export async function updateMedia(arenaId: string, id: string, patch: { altText?: string; folder?: string }, ctx: { actor: AuditActor }) {
  const scope = forArena(arenaId)
  const database = await db()
  const [row] = await database.update(schema.media).set({ ...patch }).where(scope.owns(schema.media, eq(schema.media.id, id))).returning()
  if (!row) throw notFound("Media")
  await recordAudit(ctx.actor, { action: "media.update", entityType: "media", entityId: id, arenaId: row.arenaId, description: `Updated ${row.originalName}` })
  return row
}

export async function deleteMedia(arenaId: string, id: string, ctx: { actor: AuditActor }) {
  const scope = forArena(arenaId)
  const database = await db()
  const row = await getMedia(scope.arenaId, id)
  await database.update(schema.media).set({ deletedAt: new Date() }).where(scope.owns(schema.media, eq(schema.media.id, id)))
  await getStorage().delete(row.storageKey)
  await recordAudit(ctx.actor, { action: "media.delete", entityType: "media", entityId: id, arenaId: row.arenaId, description: `Deleted ${row.originalName}` })
}

/**
 * Serves a stored file by its opaque storage key. Not arena-scoped: the key is
 * generated, unguessable and never derived from user input, and the route
 * streams bytes without exposing which arena they belong to.
 */
export async function resolveLocalFile(key: string) {
  const database = await db()
  const row = await database.query.media.findFirst({ where: and(eq(schema.media.storageKey, key), isNull(schema.media.deletedAt)) })
  if (!row) return null
  const localPath = getStorage().localPath(key)
  return localPath ? { path: localPath, mimeType: row.mimeType } : null
}
