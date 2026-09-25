import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion"
import { PageHeader } from "@/components/shared/page-header"
import { CmsIcon } from "@/components/site/cms-icon"
import { Spotlight } from "@/components/spotlight"
import { BlurText } from "@/components/motion"
import { getPublicSiteContent } from "@/server/services/public-content"
import { requirePublicTenantForPage } from "@/server/tenant"

export const dynamic = "force-dynamic"
export const metadata = { title: "About" }

export default async function AboutPage() {
  const { about, services, servicesPage } = await getPublicSiteContent((await requirePublicTenantForPage()).arenaId)
  return (
    <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <Reveal trigger="mount">
        <PageHeader eyebrow="About" title={about.title} />
      </Reveal>
      <div className="mt-8 grid gap-10 lg:grid-cols-[1.5fr_1fr]">
        <Reveal trigger="mount" delay={0.08} className="space-y-6">
          <p className="whitespace-pre-line text-pretty text-lg leading-relaxed text-muted-foreground">{about.description}</p>
          {about.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={about.imageUrl} alt="" className="w-full rounded-3xl border border-border object-cover transition-transform duration-700 hover:scale-[1.02]" />
          )}
        </Reveal>
        <Reveal trigger="mount" delay={0.14} className="space-y-4">
          <Spotlight className="glass rounded-2xl p-6 transition-transform duration-500 hover:-translate-y-1">
            <p className="label-mono text-muted-foreground"><span className="mr-2 text-primary">01</span>/Mission</p>
            <p className="mt-4 text-pretty text-lg leading-relaxed">{about.mission}</p>
          </Spotlight>
          <Spotlight className="glass rounded-2xl p-6 transition-transform duration-500 hover:-translate-y-1">
            <p className="label-mono text-muted-foreground"><span className="mr-2 text-primary">02</span>/Vision</p>
            <p className="mt-4 text-pretty text-lg leading-relaxed">{about.vision}</p>
          </Spotlight>
        </Reveal>
      </div>
      {services.length > 0 && (
        <section className="mt-20">
          <Reveal>
            <p className="label-mono text-muted-foreground"><span className="text-primary">/</span>Services</p>
          </Reveal>
          <BlurText text={servicesPage.title} className="mt-4 text-4xl font-semibold uppercase sm:text-5xl" />
          <Reveal delay={0.1}><p className="mt-3 text-muted-foreground">{servicesPage.subtitle}</p></Reveal>
          <StaggerGroup className="mt-8 grid gap-4 sm:grid-cols-2" stagger={0.08}>
            {services.map((s) => (
              <StaggerItem key={s.id} className="h-full">
                <Spotlight className="glass group flex h-full gap-4 rounded-2xl p-5 transition-transform duration-500 hover:-translate-y-1">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 ring-1 ring-primary/20 transition-transform duration-500 group-hover:scale-110"><CmsIcon name={s.icon} className="size-5 text-primary" /></div>
                  <div>
                    <h3 className="font-semibold">{s.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
                  </div>
                </Spotlight>
              </StaggerItem>
            ))}
          </StaggerGroup>
        </section>
      )}
    </main>
  )
}
