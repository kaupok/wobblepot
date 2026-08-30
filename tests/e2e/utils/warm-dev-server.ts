// COMPONENTS: Playwright globalSetup (local dev-server warm-up, HON-569)
import type { FullConfig } from '@playwright/test'

/**
 * Pre-compile the auth-critical routes on the local `next dev` server before
 * the workers stampede (HON-569).
 *
 * Why: per-step timings show the sign-up handler itself is fast (scrypt
 * ~1.1s, HIBP ~0.1–1.3s, invite-code ~0.15s, total 1.6–3.1s), yet a sign-up
 * POST still intermittently hit the 30s test timeout with *no* handler timing
 * line at all — the request stalled before the handler ran, in Turbopack's
 * first-hit compile of the route while both workers demanded different
 * uncompiled pages at once. Warming the routes serially up front removes that
 * contention. CI (`next start`, prebuilt) and remote tiers skip this.
 */
export const WARM_ROUTES = [
  '/',
  '/sign-up',
  '/sign-in',
  '/onboarding',
  '/profile',
  '/api/auth/get-session',
]

/**
 * The two env keys that decide warming. Next's generated env typegen narrows
 * `NodeJS.ProcessEnv` to declared vars only, so `process.env` is cast to this
 * minimal shape instead of typed against ProcessEnv directly.
 */
interface WarmDecisionEnv {
  CI?: string
  PLAYWRIGHT_BASE_URL?: string
}

/** Warm only local dev servers — never CI (`next start`) or remote tiers. */
export function shouldWarmDevServer(
  env: WarmDecisionEnv = process.env as WarmDecisionEnv,
): boolean {
  return !env.CI && !env.PLAYWRIGHT_BASE_URL
}

/**
 * GET each route once, serially, so Turbopack compiles them one at a time.
 * Failures are non-fatal: a route that 500s here still got compiled, and the
 * suite's own assertions decide what is broken.
 */
export async function warmRoutes(baseURL: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  for (const route of WARM_ROUTES) {
    const started = Date.now()
    try {
      // `redirect: 'manual'` — auth-gated pages 307 to /sign-in; following
      // would just re-fetch a route we warm anyway.
      const res = await fetchImpl(new URL(route, baseURL).href, { redirect: 'manual' })
      // eslint-disable-next-line no-console
      console.log(`[warm-dev-server] ${route} ${res.status} in ${Date.now() - started}ms`)
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`[warm-dev-server] ${route} failed (non-fatal):`, error)
    }
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  if (!shouldWarmDevServer()) return
  const baseURL = config.projects[0]?.use?.baseURL
  if (!baseURL) return
  // eslint-disable-next-line no-console
  console.log(`[warm-dev-server] pre-compiling ${WARM_ROUTES.length} routes on ${baseURL}…`)
  await warmRoutes(baseURL)
}
