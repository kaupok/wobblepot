/**
 * Same-origin reverse proxy for the PostHog browser SDK (HON-985).
 *
 * Ad blockers match `*.i.posthog.com` by host, so the browser sends PostHog
 * traffic to `/ingest/…` on our own origin and `next.config.ts` rewrites it to
 * PostHog EU. Server-side capture (`src/lib/posthog-server.ts`) runs in Node,
 * where a relative path does not resolve, so it keeps calling
 * `NEXT_PUBLIC_POSTHOG_HOST` directly.
 *
 * No `@/` imports: `next.config.ts` imports this file by relative path.
 */

/** Browser `api_host`. Also the rewrite source prefix and the proxy matcher exclusion. */
export const POSTHOG_PROXY_PATH = '/ingest'

/**
 * Browser `ui_host`: the toolbar and "open in PostHog" links need the app host
 * once `api_host` is relative. The toolbar calls it with `fetch`, so it is the
 * one PostHog host left in the CSP `connect-src` (src/proxy.ts). It is the app,
 * not an ingest host, so it does not undo the proxy.
 */
export const POSTHOG_UI_HOST = 'https://eu.posthog.com'

interface Rewrite {
  source: string
  destination: string
}

/**
 * Rewrite rules for `next.config.ts`, built from the ingest host
 * (`NEXT_PUBLIC_POSTHOG_HOST`), in PostHog's documented order. `static/` (SDK
 * extensions) and `array/` (remote config) go to the assets host, which sends
 * `cache-control` where the ingest host strips it. They come before
 * `/ingest/:path*`, which would otherwise match them too. The assets host is
 * the ingest host with `<region>.i.` replaced by `<region>-assets.i.`. No host
 * means PostHog is off, so no rules.
 */
export function postHogRewrites(ingestHost: string | undefined): Rewrite[] {
  if (!ingestHost) return []

  const ingest = new URL(ingestHost)
  const assets = new URL(ingest)
  assets.hostname = ingest.hostname.replace(/^([a-z]+)\.i\./, '$1-assets.i.')

  return [
    {
      source: `${POSTHOG_PROXY_PATH}/static/:path*`,
      destination: `${assets.origin}/static/:path*`,
    },
    {
      source: `${POSTHOG_PROXY_PATH}/array/:path*`,
      destination: `${assets.origin}/array/:path*`,
    },
    {
      source: `${POSTHOG_PROXY_PATH}/:path*`,
      destination: `${ingest.origin}/:path*`,
    },
  ]
}
