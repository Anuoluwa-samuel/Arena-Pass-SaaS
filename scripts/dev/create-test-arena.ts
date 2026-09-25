/**
 * Creates a second arena locally so tenant isolation can be exercised by hand
 * before the multi-tenant seed lands.
 *
 *   npx tsx --conditions=react-server scripts/dev/create-test-arena.ts lekki "Lekki Football Arena"
 *
 * Idempotent: running it again leaves the existing arena alone. Development
 * only — it refuses to run against a production environment.
 */
import { eq } from "drizzle-orm"
import { db, schema } from "@/server/db"
import { env } from "@/server/env"
import { DEFAULT_CMS_CONTENT } from "@/lib/cms/defaults"
import { hashPassword } from "@/server/auth/password"

async function main() {
  if (env.isProd) throw new Error("create-test-arena is a development helper and must not run in production")

  const slug = (process.argv[2] ?? "lekki").toLowerCase()
  const name = process.argv[3] ?? `${slug[0].toUpperCase()}${slug.slice(1)} Arena`
  const database = await db()

  const existing = await database.query.arenas.findFirst({ where: eq(schema.arenas.slug, slug) })
  if (existing) {
    console.log(`Arena "${slug}" already exists (${existing.id}), status ${existing.status}.`)
    return
  }

  const [organization] = await database
    .insert(schema.organizations)
    .values({ slug, name: `${name} Ltd`, status: "ACTIVE", billingEmail: `billing@${slug}.test` })
    .returning()

  const [arena] = await database
    .insert(schema.arenas)
    .values({
      slug,
      name,
      organizationId: organization.id,
      city: "Lagos",
      status: "ACTIVE",
      onboardingStep: "launched",
      launchedAt: new Date(),
      brandPrimaryColor: "#16a34a",
    })
    .returning()

  for (const [pageSlug, content] of Object.entries(DEFAULT_CMS_CONTENT)) {
    await database
      .insert(schema.cmsPages)
      .values({
        arenaId: arena.id,
        slug: pageSlug as keyof typeof DEFAULT_CMS_CONTENT,
        draft: content,
        published: content,
        publishedAt: new Date(),
      })
      .onConflictDoNothing()
  }

  await database.insert(schema.systemSettings).values({ arenaId: arena.id, key: "siteName", value: name }).onConflictDoNothing()

  // An owner for this arena, and only this arena.
  const ownerRole = (await database.query.roles.findFirst({ where: eq(schema.roles.key, "ARENA_OWNER") }))!
  const email = `owner@${slug}.local`
  const [owner] = await database
    .insert(schema.users)
    .values({ name: `${name} Owner`, email, passwordHash: await hashPassword("ChangeMe123!") })
    .returning()
  await database
    .insert(schema.arenaMemberships)
    .values({ arenaId: arena.id, userId: owner.id, roleId: ownerRole.id, status: "ACTIVE", acceptedAt: new Date() })
  console.log(`Owner login: ${email} / ChangeMe123!`)

  console.log(`Created arena "${slug}" (${arena.id}) under organization ${organization.id}.`)
  console.log(`Reach it with:  curl -H 'x-arena-slug: ${slug}' http://localhost:4100/api/sessions`)
  console.log(`           or:  curl -H 'Host: ${slug}.localhost' http://localhost:4100/api/sessions`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
