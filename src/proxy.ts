import { NextRequest, NextResponse } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'

/**
 * Routes that require a signed-in user. Prefix match on `nextUrl.pathname`.
 *
 * Optimistic: checks presence of the Better Auth session cookie, not validity —
 * every page under these prefixes still runs its own `getSession()` check, so a
 * stale cookie falls through to the page's redirect exactly as today. A route
 * missing from this list is not a security hole; it just keeps today's streamed
 * client-side redirect (HON-599).
 *
 * Deliberate exclusions — do not add these:
 *
 * - `/admin/**`: redirecting anonymous requests to sign-in would advertise that
 *   an admin route exists. Its intended response is a 404, served by
 *   `src/app/admin/layout.tsx` (HON-593). Leave it on the current path — neutral
 *   root skeleton + `noindex` + client-side 404.
 * - `/api/**`: API routes return their own 401 JSON. A 307 to an HTML page would
 *   break `apiFetch` callers.
 * - `/`, `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`,
 *   `/privacy`, `/terms`, `/status`, `/bot`: public. `/` renders the landing
 *   page for anonymous visitors.
 * - `/meal-plan`: legacy path that already `redirect()`s unconditionally, before
 *   any Suspense boundary.
 *
 * Note that a path *under* a listed prefix cannot be excluded by this list —
 * the match is a prefix match. `/household/invites` is the live example: it is
 * another legacy unconditional redirect, but `/household` below matches it, so
 * anonymous hits take the 307 and the legacy redirect runs after sign-in. If a
 * public route ever needs to live under a protected prefix, it needs a real
 * exclusion check here, not an entry in this comment.
 *
 * There is no `/recipes/[id]/page.tsx` — recipe detail renders client-side
 * inside `/recipes` — so every `/recipes/**` route is gated. If a public recipe
 * route is ever added it must be excluded here.
 *
 * Never do the inverse: do not redirect *away* from `/sign-in` or `/sign-up`
 * when a cookie is present. A stale-but-present cookie would loop
 * (proxy → `/` → page sees no valid session → `redirect('/sign-in')` → proxy → …).
 * `src/app/sign-in/page.tsx` already handles that direction with a real session
 * check, which is the correct layer for it (HON-299).
 *
 * Exported so `src/proxy.test.ts` can assert every prefix redirects — a new
 * entry is then covered without touching the test.
 */
export const PROTECTED_PREFIXES = [
  '/profile',
  '/recipes',
  '/household',
  '/shopping',
  '/pantry',
  '/onboarding',
  '/invite',
] as const

/**
 * Exact-or-segment-boundary match, so `/profilex` and a hypothetical
 * `/recipes-public` do not match `/profile` / `/recipes`.
 */
function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

/**
 * Next's RSC cache-busting query param (`NEXT_RSC_UNION_QUERY`, i.e. `_rsc`,
 * `app-router-headers.js:111`). `config.matcher` only excludes *prefetches*, so
 * a soft navigation still reaches the proxy carrying it — and without stripping
 * it the param survives sign-in into the address bar, `useSearchParams()`, and
 * every later copy/paste of that URL.
 */
const RSC_QUERY_PARAM = '_rsc'

/** `pathname` plus its query string, minus Next's internal params. */
function buildReturnUrl(pathname: string, search: string): string {
  if (!search) return pathname

  const params = new URLSearchParams(search)
  params.delete(RSC_QUERY_PARAM)

  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

function generateNonce(): string {
  const uuid = crypto.randomUUID()
  return btoa(uuid)
}

function buildCspHeader(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development'

  const directives: string[] = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : " 'strict-dynamic'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.posthog.com",
    "font-src 'self'",
    "connect-src 'self' https://*.posthog.com https://eu.i.posthog.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ]

  if (!isDev) {
    directives.push('upgrade-insecure-requests')
  }

  return directives.join('; ')
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  // Runs before the response body streams, so this is a real 307 rather than the
  // client-side redirect a page-level `redirect()` produces once a Suspense
  // fallback has already flushed a 200 (HON-599).
  if (isProtectedPath(pathname) && getSessionCookie(request) === null) {
    return NextResponse.redirect(
      new URL(
        `/sign-in?returnUrl=${encodeURIComponent(buildReturnUrl(pathname, search))}`,
        request.url,
      ),
    )
  }

  const nonce = generateNonce()
  const cspHeader = buildCspHeader(nonce)

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  })

  response.headers.set('Content-Security-Policy', cspHeader)

  return response
}

export const config = {
  matcher: [
    {
      source:
        '/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|sw.js|robots.txt|sitemap.xml).*)',
      missing: [{ type: 'header', key: 'next-router-prefetch' }],
    },
  ],
}
