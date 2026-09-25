import { FaqList } from "@/components/site/faq-list"
import { Reveal } from "@/components/motion"
import { PageHeader } from "@/components/shared/page-header"
import { getPublicSiteContent } from "@/server/services/public-content"
import { requirePublicTenantForPage } from "@/server/tenant"

export const dynamic = "force-dynamic"
export const metadata = { title: "FAQ" }

export default async function FaqPage() {
  const { faqs, contact } = await getPublicSiteContent((await requirePublicTenantForPage()).arenaId)
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <Reveal trigger="mount">
        <PageHeader eyebrow="Help" title="Frequently asked questions" description="Can't find what you need? Email us and we'll get back to you the same day." />
      </Reveal>
      <Reveal trigger="mount" delay={0.1} className="mt-8">
        {faqs.length === 0 ? (
          <p className="text-muted-foreground">No FAQs published yet.</p>
        ) : (
          <FaqList faqs={faqs} />
        )}
      </Reveal>
      {contact.email && (
        <Reveal className="glass mt-10 flex items-center justify-between gap-4 rounded-2xl px-6 py-5 text-sm"><span className="text-muted-foreground">Still stuck?</span><a href={`mailto:${contact.email}`} className="font-medium text-primary hover:underline">{contact.email}</a></Reveal>
      )}
    </main>
  )
}
