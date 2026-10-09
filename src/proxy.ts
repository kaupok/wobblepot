import { NextRequest, NextResponse } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'
import { isPostHogProxyPath, POSTHOG_UI_HOST } from '@/lib/posthog-proxy'

/**
 * Routes that require a signed-in user. Prefix match on `nextUrl.pathname`.
 *
 * Optimistic: checks presence of the Better Auth session cookie, not validity —
 * every page under these prefixes still runs its own `getSession()` check, so a
 * stale cookie falls through to the page's redirect exactly as today. A route
 * missing from this list is not a security hole; it just keeps today's streamed
 * client-side redirect (HON-599).
 *
 * Every top-level route under `src/app/` must be listed here or in
 * `PUBLIC_ROUTES` below — `src/proxy.test.ts` fails on one that is in neither.
 *
 * Note that a path *under* a listed prefix cannot be excluded by this list —
 * the match is a prefix match. `/household/invites` is the live example: it is
 * another legacy unconditional redirect, but `/household` below matches it, so
 * anonymous hits take the 307 and the legacy redirect runs after sign-in. If a
 * public route ever needs to live under a protected prefix, it needs a real
 * exclusion check here — `PUBLIC_ROUTES` is not read at runtime.
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
  '/past-meals',
  '/recipes',
  '/household',
  '/shopping',
  '/pantry',
  '/onboarding',
] as const

/**
 * Top-level routes the proxy deliberately does *not* redirect — do not move
 * these into `PROTECTED_PREFIXES`. Not read at runtime: it exists so
 * `src/proxy.test.ts` can require every top-level `src/app/` route to be
 * classified one way or the other, with the reason recorded next to the entry.
 * `/` is public by definition and has no entry.
 */
export const PUBLIC_ROUTES = [
  {
    path: '/admin',
    reason:
      'Must 404 for anonymous users, not advertise itself via a sign-in redirect — rewritten to a real 404 below, and gated for signed-in non-admins by src/app/admin/layout.tsx (HON-593, HON-830)',
  },
  {
    path: '/api',
    reason: 'API routes return their own 401 JSON; a 307 to an HTML page would break apiFetch',
  },
  { path: '/sign-in', reason: 'Auth flow — see the never-redirect note above (HON-299)' },
  { path: '/sign-up', reason: 'Auth flow' },
  { path: '/forgot-password', reason: 'Auth flow' },
  { path: '/reset-password', reason: 'Auth flow' },
  {
    path: '/request-invite',
    reason:
      'A visitor without an account asks for an invite and confirms it from an emailed link (HON-846)',
  },
  {
    path: '/invite',
    reason:
      'A signed-out invitee opens a household invite link and creates an account from it; the page owns the session check (HON-1131)',
  },
  {
    path: '/reminders',
    reason:
      'The weekly reminder email links to /reminders/stop, which must work without a sign-in (HON-1084)',
  },
  { path: '/privacy', reason: 'Legal page, served from the (legal) route group' },
  { path: '/terms', reason: 'Legal page, served from the (legal) route group' },
  { path: '/status', reason: 'Public status page' },
  {
    path: '/bot',
    reason: 'Public explainer for the Wobblepot-Bot crawler user agent, linked from its UA string',
  },
  {
    path: '/meal-plan',
    reason: 'Legacy path that redirect()s unconditionally, before any Suspense boundary',
  },
] as const satisfies readonly { path: `/${string}`; reason: string }[]

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
 * The admin segment must be indistinguishable from a path that does not exist.
 * `src/app/admin/layout.tsx` already renders the not-found UI for non-admins,
 * but the root `src/app/loading.tsx` streams a 200 before that layout runs, and
 * a streamed status cannot change. So a cookie-less request is rewritten here,
 * before anything streams, to a path no route can ever match — `_`-prefixed
 * folders are private in the App Router — and Next serves its ordinary 404
 * with a 404 status. A rewrite keeps the URL; a redirect would advertise the
 * route (HON-830).
 *
 * A signed-in non-admin still passes through, since the proxy cannot see who
 * is an admin: they get the 404 UI and title, but with a 200.
 */
const ADMIN_PREFIX = '/admin'
export const NOT_FOUND_REWRITE_PATH = '/_not-a-route'

function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`)
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
    "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com",
    "font-src 'self'",
    // PostHog's SDK traffic is same-origin through the `/ingest` rewrite (HON-985).
    // Only the app host stays, for the toolbar's API calls.
    `connect-src 'self' ${POSTHOG_UI_HOST}`,
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

  // The `/ingest` rewrite in next.config.ts forwards request headers to PostHog
  // unchanged, and a same-origin request carries every first-party cookie,
  // including the Better Auth session token. PostHog needs none of them (the
  // SDK sends `distinct_id` in the body), so drop the header before the rewrite
  // runs. Nothing else here applies to analytics traffic (HON-985).
  if (isPostHogProxyPath(pathname)) {
    const headers = new Headers(request.headers)
    headers.delete('cookie')
    return NextResponse.next({ request: { headers } })
  }

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

  // Both branches carry the nonce and CSP, so the admin 404 renders exactly as
  // it does for any other unknown path.
  const response =
    isAdminPath(pathname) && getSessionCookie(request) === null
      ? NextResponse.rewrite(new URL(NOT_FOUND_REWRITE_PATH, request.url), {
          request: { headers: requestHeaders },
        })
      : NextResponse.next({
          request: { headers: requestHeaders },
        })

  response.headers.set('Content-Security-Policy', cspHeader)

  return response
}

export const config = {
  // `/ingest/` (the PostHog rewrite) stays in: `proxy()` strips its cookies.
  matcher: [
    {
      source:
        '/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|sw.js|robots.txt|sitemap.xml).*)',
      missing: [{ type: 'header', key: 'next-router-prefetch' }],
    },
  ],
}
