import "server-only"
import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm"
import { z } from "zod"
import { forArena } from "@/server/db/scoped"
import { db, schema } from "@/server/db"
import { AppError, notFound } from "@/server/http/errors"
import { CMS_PAGE_SCHEMAS, type CmsContentBySlug } from "@/lib/cms/schemas"
import { DEFAULT_CMS_CONTENT } from "@/lib/cms/defaults"
import type { CmsPageSlug } from "@/lib/domain/constants"
import { recordAudit, type AuditActor } from "./audit"

// ---------------------------------------------------------------------------
// Pages (draft / published JSON documents validated per slug)
// ---------------------------------------------------------------------------
export async function getPage<S extends CmsPageSlug>(arenaId: string, slug: S) {
  const database = await db()
  const row = await database.query.cmsPages.findFirst({ where: and(eq(schema.cmsPages.arenaId, arenaId), eq(schema.cmsPages.slug, slug)) })
  const schemaFor = CMS_PAGE_SCHEMAS[slug]
  const parse = (v: unknown) => {
    const r = schemaFor.safeParse(v)
    return (r.success ? r.data : DEFAULT_CMS_CONTENT[slug]) as CmsContentBySlug[S]
  }
  return {
    id: row?.id ?? null,
    slug,
    draft: parse(row?.draft),
    published: parse(row?.published ?? row?.draft),
    publishedAt: row?.publishedAt ?? null,
    updatedAt: row?.updatedAt ?? null,
    hasUnpublishedChanges: !!row && JSON.stringify(row.draft) !== JSON.stringify(row.published),
  }
}

/** Public read: the published document only. */
export async function getPublishedPage<S extends CmsPageSlug>(arenaId: string, slug: S): Promise<CmsContentBySlug[S]> {
  return (await getPage(arenaId, slug)).published
}

export async function saveDraft<S extends CmsPageSlug>(arenaId: string, slug: S, content: unknown, ctx: { actor: AuditActor }) {
  const database = await db()
  const parsed = CMS_PAGE_SCHEMAS[slug].parse(content)
  const existing = await database.query.cmsPages.findFirst({ where: and(eq(schema.cmsPages.arenaId, arenaId), eq(schema.cmsPages.slug, slug)) })
  if (existing) {
    await database.update(schema.cmsPages).set({ draft: parsed, updatedBy: ctx.actor.id ?? null, updatedAt: new Date() }).where(eq(schema.cmsPages.id, existing.id))
  } else {
    await database.insert(schema.cmsPages).values({ arenaId, slug, draft: parsed, updatedBy: ctx.actor.id ?? null })
  }
  await recordAudit(ctx.actor, { action: "cms.page.save_draft", entityType: "cms_page", entityId: slug, arenaId, description: `Saved draft of ${slug} page` })
  return getPage(arenaId, slug)
}

export async function publishPage<S extends CmsPageSlug>(arenaId: string, slug: S, ctx: { actor: AuditActor }) {
  const database = await db()
  const existing = await database.query.cmsPages.findFirst({ where: and(eq(schema.cmsPages.arenaId, arenaId), eq(schema.cmsPages.slug, slug)) })
  if (!existing) throw notFound("Page")
  await database.update(schema.cmsPages).set({ published: existing.draft, publishedAt: new Date(), updatedBy: ctx.actor.id ?? null, updatedAt: new Date() }).where(eq(schema.cmsPages.id, existing.id))
  await recordAudit(ctx.actor, { action: "cms.page.publish", entityType: "cms_page", entityId: slug, arenaId, description: `Published ${slug} page` })
  return getPage(arenaId, slug)
}

export async function discardDraft<S extends CmsPageSlug>(arenaId: string, slug: S, ctx: { actor: AuditActor }) {
  const database = await db()
  const existing = await database.query.cmsPages.findFirst({ where: and(eq(schema.cmsPages.arenaId, arenaId), eq(schema.cmsPages.slug, slug)) })
  if (!existing) throw notFound("Page")
  await database.update(schema.cmsPages).set({ draft: existing.published ?? existing.draft, updatedAt: new Date() }).where(eq(schema.cmsPages.id, existing.id))
  await recordAudit(ctx.actor, { action: "cms.page.discard_draft", entityType: "cms_page", entityId: slug, arenaId, description: `Discarded draft of ${slug} page` })
  return getPage(arenaId, slug)
}

// ---------------------------------------------------------------------------
// Services (offerings)
// ---------------------------------------------------------------------------
export const serviceInputSchema = z.object({
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().min(2).max(600),
  icon: z.string().max(40).optional().or(z.literal("")),
  imageMediaId: z.string().uuid().nullable().optional(),
  isPublished: z.boolean().default(true),
})

export async function listServices(arenaId: string, opts: { publishedOnly?: boolean } = {}) {
  const database = await db()
  return database.query.cmsServices.findMany({
    where: and(eq(schema.cmsServices.arenaId, arenaId), opts.publishedOnly ? eq(schema.cmsServices.isPublished, true) : undefined),
    orderBy: [asc(schema.cmsServices.sortOrder), asc(schema.cmsServices.createdAt)],
  })
}

export async function createService(arenaId: string, input: z.infer<typeof serviceInputSchema>, ctx: { actor: AuditActor }) {
  const database = await db()
  const [{ max }] = await database.select({ max: sql<number>`coalesce(max(${schema.cmsServices.sortOrder}), 0)::int` }).from(schema.cmsServices).where(eq(schema.cmsServices.arenaId, arenaId))
  const [row] = await database.insert(schema.cmsServices).values({ arenaId, ...input, icon: input.icon || null, imageMediaId: input.imageMediaId ?? null, sortOrder: Number(max) + 1 }).returning()
  await recordAudit(ctx.actor, { action: "cms.service.create", entityType: "cms_service", entityId: row.id, arenaId, description: `Added service "${row.title}"` })
  return row
}

export async function updateService(arenaId: string, id: string, input: Partial<z.infer<typeof serviceInputSchema>>, ctx: { actor: AuditActor }) {
  const database = await db()
  const [row] = await database.update(schema.cmsServices).set({ ...input, icon: input.icon === "" ? null : input.icon, updatedAt: new Date() }).where(forArena(arenaId).owns(schema.cmsServices, eq(schema.cmsServices.id, id))).returning()
  if (!row) throw notFound("Service")
  await recordAudit(ctx.actor, { action: "cms.service.update", entityType: "cms_service", entityId: id, arenaId: row.arenaId, description: `Updated service "${row.title}"` })
  return row
}

export async function deleteService(arenaId: string, id: string, ctx: { actor: AuditActor }) {
  const database = await db()
  const [row] = await database.delete(schema.cmsServices).where(forArena(arenaId).owns(schema.cmsServices, eq(schema.cmsServices.id, id))).returning()
  if (!row) throw notFound("Service")
  await recordAudit(ctx.actor, { action: "cms.service.delete", entityType: "cms_service", entityId: id, arenaId: row.arenaId, description: `Deleted service "${row.title}"` })
}

// ---------------------------------------------------------------------------
// FAQs
// ---------------------------------------------------------------------------
export const faqInputSchema = z.object({
  question: z.string().trim().min(3).max(200),
  answer: z.string().trim().min(3).max(3000),
  isPublished: z.boolean().default(true),
})

export async function listFaqs(arenaId: string, opts: { publishedOnly?: boolean } = {}) {
  const database = await db()
  return database.query.faqs.findMany({
    where: and(eq(schema.faqs.arenaId, arenaId), opts.publishedOnly ? eq(schema.faqs.isPublished, true) : undefined),
    orderBy: [asc(schema.faqs.sortOrder), asc(schema.faqs.createdAt)],
  })
}

export async function createFaq(arenaId: string, input: z.infer<typeof faqInputSchema>, ctx: { actor: AuditActor }) {
  const database = await db()
  const [{ max }] = await database.select({ max: sql<number>`coalesce(max(${schema.faqs.sortOrder}), 0)::int` }).from(schema.faqs).where(eq(schema.faqs.arenaId, arenaId))
  const [row] = await database.insert(schema.faqs).values({ arenaId, ...input, sortOrder: Number(max) + 1 }).returning()
  await recordAudit(ctx.actor, { action: "cms.faq.create", entityType: "faq", entityId: row.id, arenaId, description: `Added FAQ "${row.question}"` })
  return row
}

export async function updateFaq(arenaId: string, id: string, input: Partial<z.infer<typeof faqInputSchema>>, ctx: { actor: AuditActor }) {
  const database = await db()
  const [row] = await database.update(schema.faqs).set({ ...input, updatedAt: new Date() }).where(forArena(arenaId).owns(schema.faqs, eq(schema.faqs.id, id))).returning()
  if (!row) throw notFound("FAQ")
  await recordAudit(ctx.actor, { action: "cms.faq.update", entityType: "faq", entityId: id, arenaId: row.arenaId, description: `Updated FAQ "${row.question}"` })
  return row
}

export async function deleteFaq(arenaId: string, id: string, ctx: { actor: AuditActor }) {
  const database = await db()
  const [row] = await database.delete(schema.faqs).where(forArena(arenaId).owns(schema.faqs, eq(schema.faqs.id, id))).returning()
  if (!row) throw notFound("FAQ")
  await recordAudit(ctx.actor, { action: "cms.faq.delete", entityType: "faq", entityId: id, arenaId: row.arenaId, description: `Deleted FAQ "${row.question}"` })
}

/** Generic reorder used by FAQs, services and banners: ids in desired order. */
export async function reorder(table: "faqs" | "cms_services" | "banners", orderedIds: string[], ctx: { actor: AuditActor; arenaId: string }) {
  const database = await db()
  const target = table === "faqs" ? schema.faqs : table === "cms_services" ? schema.cmsServices : schema.banners
  await database.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.update(target).set({ sortOrder: i + 1 }).where(and(eq(target.id, orderedIds[i]), eq(target.arenaId, ctx.arenaId)))
    }
  })
  await recordAudit(ctx.actor, { action: `cms.${table}.reorder`, entityType: table, arenaId: ctx.arenaId, description: `Reordered ${table.replace("cms_", "")}` })
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------
export const announcementInputSchema = z.object({
  title: z.string().trim().min(3).max(160),
  content: z.string().trim().min(3).max(5000),
  imageMediaId: z.string().uuid().nullable().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
  publishAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
})

export async function listAnnouncements(arenaId: string, opts: { status?: string; page?: number; pageSize?: number } = {}) {
  const database = await db()
  const page = opts.page ?? 1
  const pageSize = opts.pageSize ?? 20
  const where = and(eq(schema.announcements.arenaId, arenaId), opts.status && opts.status !== "all" ? eq(schema.announcements.status, opts.status as schema.Announcement["status"]) : undefined)
  const [{ count }] = await database.select({ count: sql<number>`count(*)::int` }).from(schema.announcements).where(where)
  const items = await database.select().from(schema.announcements).where(where).orderBy(desc(schema.announcements.createdAt)).limit(pageSize).offset((page - 1) * pageSize)
  return { items, meta: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) } }
}

/** Public: published, within publish/expiry window. */
export async function listLiveAnnouncements(arenaId: string, limit = 5) {
  const database = await db()
  const now = new Date()
  return database
    .select()
    .from(schema.announcements)
    .where(
      and(
        eq(schema.announcements.arenaId, arenaId),
        eq(schema.announcements.status, "PUBLISHED"),
        or(isNull(schema.announcements.publishAt), lte(schema.announcements.publishAt, now)),
        or(isNull(schema.announcements.expiresAt), gte(schema.announcements.expiresAt, now))
      )
    )
    .orderBy(desc(schema.announcements.publishAt), desc(schema.announcements.createdAt))
    .limit(limit)
}

export async function createAnnouncement(arenaId: string, input: z.infer<typeof announcementInputSchema>, ctx: { actor: AuditActor }) {
  const database = await db()
  const [row] = await database.insert(schema.announcements).values({ arenaId, ...input, imageMediaId: input.imageMediaId ?? null, publishAt: input.publishAt ?? (input.status === "PUBLISHED" ? new Date() : null), expiresAt: input.expiresAt ?? null, createdBy: ctx.actor.id ?? null }).returning()
  await recordAudit(ctx.actor, { action: "cms.announcement.create", entityType: "announcement", entityId: row.id, arenaId, description: `Created announcement "${row.title}"` })
  return row
}

export async function updateAnnouncement(arenaId: string, id: string, input: Partial<z.infer<typeof announcementInputSchema>>, ctx: { actor: AuditActor }) {
  const database = await db()
  const [row] = await database.update(schema.announcements).set({ ...input, updatedAt: new Date() }).where(forArena(arenaId).owns(schema.announcements, eq(schema.announcements.id, id))).returning()
  if (!row) throw notFound("Announcement")
  await recordAudit(ctx.actor, { action: "cms.announcement.update", entityType: "announcement", entityId: id, arenaId: row.arenaId, description: `Updated announcement "${row.title}"` })
  return row
}

export async function deleteAnnouncement(arenaId: string, id: string, ctx: { actor: AuditActor }) {
  const database = await db()
  const [row] = await database.delete(schema.announcements).where(forArena(arenaId).owns(schema.announcements, eq(schema.announcements.id, id))).returning()
  if (!row) throw notFound("Announcement")
  await recordAudit(ctx.actor, { action: "cms.announcement.delete", entityType: "announcement", entityId: id, arenaId: row.arenaId, description: `Deleted announcement "${row.title}"` })
}

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------
export const bannerInputSchema = z.object({
  title: z.string().trim().min(2).max(120),
  subtitle: z.string().trim().max(240).optional().or(z.literal("")),
  imageMediaId: z.string().uuid().nullable().optional(),
  linkUrl: z.string().trim().max(500).optional().or(z.literal("")),
  linkLabel: z.string().trim().max(60).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
})

export async function listBanners(arenaId: string, opts: { activeOnly?: boolean } = {}) {
  const database = await db()
  const now = new Date()
  const rows = await database
    .select({ banner: schema.banners, image: { url: schema.media.url, altText: schema.media.altText } })
    .from(schema.banners)
    .leftJoin(schema.media, eq(schema.media.id, schema.banners.imageMediaId))
    .where(
      and(
        eq(schema.banners.arenaId, arenaId),
        opts.activeOnly ? eq(schema.banners.isActive, true) : undefined,
        opts.activeOnly ? or(isNull(schema.banners.startsAt), lte(schema.banners.startsAt, now)) : undefined,
        opts.activeOnly ? or(isNull(schema.banners.endsAt), gte(schema.banners.endsAt, now)) : undefined
      )
    )
    .orderBy(asc(schema.banners.sortOrder), asc(schema.banners.createdAt))
  return rows
}

export async function createBanner(arenaId: string, input: z.infer<typeof bannerInputSchema>, ctx: { actor: AuditActor }) {
  const database = await db()
  const [{ max }] = await database.select({ max: sql<number>`coalesce(max(${schema.banners.sortOrder}), 0)::int` }).from(schema.banners).where(eq(schema.banners.arenaId, arenaId))
  const [row] = await database.insert(schema.banners).values({ arenaId, ...input, subtitle: input.subtitle || null, linkUrl: input.linkUrl || null, linkLabel: input.linkLabel || null, imageMediaId: input.imageMediaId ?? null, startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null, sortOrder: Number(max) + 1 }).returning()
  await recordAudit(ctx.actor, { action: "cms.banner.create", entityType: "banner", entityId: row.id, arenaId, description: `Created banner "${row.title}"` })
  return row
}

export async function updateBanner(arenaId: string, id: string, input: Partial<z.infer<typeof bannerInputSchema>>, ctx: { actor: AuditActor }) {
  const database = await db()
  const [row] = await database.update(schema.banners).set({ ...input, subtitle: input.subtitle === "" ? null : input.subtitle, linkUrl: input.linkUrl === "" ? null : input.linkUrl, linkLabel: input.linkLabel === "" ? null : input.linkLabel, updatedAt: new Date() }).where(forArena(arenaId).owns(schema.banners, eq(schema.banners.id, id))).returning()
  if (!row) throw notFound("Banner")
  await recordAudit(ctx.actor, { action: "cms.banner.update", entityType: "banner", entityId: id, arenaId: row.arenaId, description: `Updated banner "${row.title}"` })
  return row
}

export async function deleteBanner(arenaId: string, id: string, ctx: { actor: AuditActor }) {
  const database = await db()
  const [row] = await database.delete(schema.banners).where(forArena(arenaId).owns(schema.banners, eq(schema.banners.id, id))).returning()
  if (!row) throw notFound("Banner")
  await recordAudit(ctx.actor, { action: "cms.banner.delete", entityType: "banner", entityId: id, arenaId: row.arenaId, description: `Deleted banner "${row.title}"` })
}

export function assertCmsSlug(slug: string): CmsPageSlug {
  if (!(slug in CMS_PAGE_SCHEMAS)) throw new AppError("NOT_FOUND", "Unknown page")
  return slug as CmsPageSlug
}
