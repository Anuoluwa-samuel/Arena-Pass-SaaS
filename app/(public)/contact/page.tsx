import { ArrowUpRight, Mail, MapPin, Phone, Instagram, Twitter, MessageCircle } from "lucide-react"
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion"
import { PageHeader } from "@/components/shared/page-header"
import { getPublicSiteContent } from "@/server/services/public-content"
import { requirePublicTenantForPage } from "@/server/tenant"

export const dynamic = "force-dynamic"
export const metadata = { title: "Contact" }

export default async function ContactPage() {
  const { contact, arena } = await getPublicSiteContent((await requirePublicTenantForPage()).arenaId)
  const rows = [
    contact.email && { icon: Mail, label: "Email", value: contact.email, href: `mailto:${contact.email}` },
    contact.phone && { icon: Phone, label: "Phone", value: contact.phone, href: `tel:${contact.phone}` },
    contact.whatsapp && { icon: MessageCircle, label: "WhatsApp", value: contact.whatsapp, href: `https://wa.me/${contact.whatsapp.replace(/\D/g, "")}` },
    contact.instagram && { icon: Instagram, label: "Instagram", value: contact.instagram, href: contact.instagram.startsWith("http") ? contact.instagram : `https://instagram.com/${contact.instagram.replace("@", "")}` },
    contact.twitter && { icon: Twitter, label: "X / Twitter", value: contact.twitter, href: contact.twitter.startsWith("http") ? contact.twitter : `https://x.com/${contact.twitter.replace("@", "")}` },
    contact.address && { icon: MapPin, label: "Address", value: contact.address, href: contact.mapUrl || undefined },
  ].filter(Boolean) as Array<{ icon: React.ComponentType<{ className?: string }>; label: string; value: string; href?: string }>

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <Reveal trigger="mount">
        <PageHeader eyebrow={arena.name} title="Get in touch" description="Questions about a session, group bookings or corporate events — we're happy to help." />
      </Reveal>
      <StaggerGroup trigger="mount" delayChildren={0.15} stagger={0.07} className="mt-10 grid gap-4 sm:grid-cols-2">
        {rows.map((r) => (
          <StaggerItem key={r.label}>
            <a href={r.href} target={r.href?.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="spotlight glass group flex items-start gap-4 rounded-2xl p-5 transition-[transform,border-color] duration-500 hover:-translate-y-1 hover:border-primary/40">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 ring-1 ring-primary/20 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-[-6deg]"><r.icon className="size-5 text-primary" /></div>
              <div className="min-w-0 flex-1">
                <p className="label-mono text-muted-foreground">{r.label}</p>
                <p className="mt-1 truncate font-medium">{r.value}</p>
              </div>
              {r.href && <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />}
            </a>
          </StaggerItem>
        ))}
      </StaggerGroup>
      {contact.mapUrl && (
        <Reveal delay={0.15} className="glass mt-8 overflow-hidden rounded-3xl p-1.5">
          <iframe src={contact.mapUrl} title="Map" className="h-80 w-full rounded-[1.25rem]" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
        </Reveal>
      )}
    </main>
  )
}
