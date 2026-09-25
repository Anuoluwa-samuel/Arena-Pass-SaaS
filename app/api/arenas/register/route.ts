import { after } from "next/server"
import { route, ok } from "@/server/http/response"
import { assertSameOrigin, getClientIp, parseJson } from "@/server/http/request"
import { enforceRateLimit, RATE_LIMITS } from "@/server/http/rate-limit"
import { registerArena, registerArenaSchema } from "@/server/services/onboarding"
import { createAuthSession, setSessionCookie } from "@/server/auth/session"

/**
 * Self-service arena registration. Deliberately not tenant-scoped: this is how
 * a tenant comes into existence, so it runs on the platform's own address.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req)
  const ip = getClientIp(req)
  await enforceRateLimit(RATE_LIMITS.signup, `arena-register:${ip}`)
  const input = await parseJson(req, registerArenaSchema)

  const { user, arena } = await registerArena(input, { ip })
  // Signed straight in as the owner: the next screen is their onboarding.
  const { token, ttl } = await createAuthSession("user", user.id, { ip, userAgent: req.headers.get("user-agent") })
  await setSessionCookie("user", token, ttl)
  after(async () => undefined)

  return ok(
    { arena: { id: arena.id, slug: arena.slug, name: arena.name }, nextUrl: "/admin/onboarding" },
    { status: 201, message: `${arena.name} is ready to set up` }
  )
})
