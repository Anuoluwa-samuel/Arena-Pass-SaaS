import { NextResponse, type NextRequest } from "next/server"

/**
 * Runs before every page and route.
 *
 * Two jobs:
 *
 *  1. **Content Security Policy.** A fresh nonce per request, so the only
 *     inline script the browser will run is the one this server put there.
 *     `strict-dynamic` lets that bootstrap load the rest of Next's bundles
 *     without listing them.
 *  2. **The request's path**, forwarded as `x-pathname` so a layout can tell
 *     the site's front door from the pages beneath it. Layouts do not receive
 *     the pathname, and `(public)/layout.tsx` needs it to decide whether a
 *     hostname with no arena should see the platform's welcome page or a 404.
 *  3. **A cookie-presence redirect** for admin and account pages. That is a
 *     courtesy, not a control: real authorisation happens in route handlers
 *     and server components (`server/auth/rbac.ts`), and nothing here is
 *     trusted for an access decision.
 *
 * Cache headers for private pages are set in `next.config.mjs`; the page
 * renderer overwrites a Cache-Control set here.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    if (!req.cookies.get("ap_admin_session")?.value) {
      const url = req.nextUrl.clone()
      url.pathname = "/admin/login"
      url.searchParams.set("next", pathname)
      return NextResponse.redirect(url)
    }
  }
  if (pathname.startsWith("/account")) {
    if (!req.cookies.get("ap_customer_session")?.value) {
      const url = req.nextUrl.clone()
      url.pathname = "/login"
      url.searchParams.set("next", pathname)
      return NextResponse.redirect(url)
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const isDev = process.env.NODE_ENV === "development"

  // Written for what this application actually loads, not copied:
  //  - fonts are self-hosted by next/font at build time, so no font origin;
  //  - QR codes are data: URIs and uploads are same-origin, hence img-src;
  //  - Google sign-in is a top-level redirect, not a framed or fetched
  //    resource, so it needs no connect-src or frame-src entry;
  //  - the payment provider hosts its own checkout page, which the customer
  //    is redirected to rather than embedding.
  //
  // `style-src` keeps 'unsafe-inline' deliberately. The design system and the
  // per-arena theme both emit inline styles, and threading a nonce through
  // every one of them buys little: inline styles cannot execute script, so
  // the risk they carry is a fraction of an inline script's. Scripts get no
  // such exemption.
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ")

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("x-pathname", pathname)
  const res = NextResponse.next({ request: { headers: requestHeaders } })
  res.headers.set("Content-Security-Policy", csp)
  return res
}

export const config = {
  // Everything except static assets and stored uploads — the upload route
  // sets its own, far stricter, policy for attacker-influenced bytes.
  matcher: ["/((?!_next/static|_next/image|api/media/files|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?)$).*)"],
}
