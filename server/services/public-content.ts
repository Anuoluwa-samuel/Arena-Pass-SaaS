import "server-only"
import { getArenaById } from "./arenas"
import { getMedia } from "./media"
import { getPublishedPage, listBanners, listFaqs, listLiveAnnouncements, listServices } from "./cms"
import { getSettings } from "./settings"
import { listSessions } from "./sessions"
import { toPublicSession } from "@/server/serializers"

/**
 * Only `#rgb` / `#rrggbb`. A colour goes straight into a CSS custom property,
 * so anything else is dropped rather than trusted — a stray `;` would end the
 * declaration and start another.
 */
function normaliseColor(value: string | null): string | null {
  if (!value) return null
  const hex = value.trim()
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex) ? hex.toLowerCase() : null
}

/**
 * Everything one arena's public site needs. The arena is always passed in by
 * the caller, which resolved it from the request's hostname — this service
 * has no notion of a "current" or "default" arena to fall back to.
 */
export async function getPublicSiteContent(arenaId: string) {
  const arena = await getArenaById(arenaId)
  const [homepage, about, servicesPage, contact, services, faqs, announcements, banners, settings, logo] = await Promise.all([
    getPublishedPage(arena.id, "homepage"),
    getPublishedPage(arena.id, "about"),
    getPublishedPage(arena.id, "services"),
    getPublishedPage(arena.id, "contact"),
    listServices(arena.id, { publishedOnly: true }),
    listFaqs(arena.id, { publishedOnly: true }),
    listLiveAnnouncements(arena.id),
    listBanners(arena.id, { activeOnly: true }),
    getSettings(arena.id),
    arena.logoMediaId ? getMedia(arena.id, arena.logoMediaId).catch(() => null) : null,
  ])
  return {
    arena: {
      id: arena.id,
      name: arena.name,
      city: arena.city,
      timezone: arena.timezone,
      currency: arena.currency,
      description: arena.description,
    },
    // The storefront is the arena's own site, so it wears the arena's colours.
    // Null means "use the product's default palette".
    branding: {
      logoUrl: logo?.url ?? null,
      primaryColor: normaliseColor(arena.brandPrimaryColor),
      accentColor: normaliseColor(arena.brandAccentColor),
    },
    siteName: settings.siteName,
    homepage,
    about,
    servicesPage,
    contact,
    services: services.map((s) => ({ id: s.id, title: s.title, description: s.description, icon: s.icon })),
    faqs: faqs.map((f) => ({ id: f.id, question: f.question, answer: f.answer })),
    announcements: announcements.map((a) => ({ id: a.id, title: a.title, content: a.content, publishAt: a.publishAt })),
    banners: banners.map(({ banner, image }) => ({ id: banner.id, title: banner.title, subtitle: banner.subtitle, linkUrl: banner.linkUrl, linkLabel: banner.linkLabel, imageUrl: image?.url ?? null })),
    maintenanceMode: settings.maintenanceMode,
  }
}

export type PublicSiteContent = Awaited<ReturnType<typeof getPublicSiteContent>>

/** Every session on the public site. The homepage stats and the Sessions page both count from this, so they always agree. */
export async function getPublicSessions(arenaId: string) {
  const result = await listSessions({ arenaId, publicOnly: true, pageSize: 100 })
  return result.items.map(toPublicSession)
}

export async function getFeaturedSessions(arenaId: string, limit: number) {
  const result = await listSessions({ arenaId, publicOnly: true, pageSize: limit })
  return result.items.map(toPublicSession)
}
