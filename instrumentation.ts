/**
 * Next.js instrumentation hook. The `onRequestError` export is the safety net
 * for any error that escapes a route's try/catch — uncaught throws in RSCs,
 * middleware, and API routes — and ensures it lands in PostHog with at least
 * a distinct id derived from the PostHog cookie.
 *
 * Per-route helpers in `src/lib/errors.ts` add richer context (route literal,
 * householdId, feature). This hook is the floor, not the ceiling.
 *
 * Runs only in the Node.js runtime; the edge runtime cannot use the
 * `posthog-node` SDK and is a no-op here.
 */
interface RequestErrorRequest {
  path: string
  method: string
  headers: NodeJS.Dict<string | string[]>
}

export function register(): void {
  // Intentionally empty. The PostHog server singleton is constructed lazily
  // on first capture; eager init here would force-import posthog-node into
  // the edge bundle.
}

export async function onRequestError(
  err: unknown,
  request: Readonly<RequestErrorRequest>,
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { getPosthogServer } = await import('@/lib/posthog-server')
  const client = getPosthogServer()
  if (!client) return

  const distinctId = extractDistinctIdFromCookie(request.headers.cookie)

  try {
    // Fire-and-forget. The PostHog SDK is constructed with Vercel's
    // `waitUntil` (see `posthog-server.ts`), so the queued send schedules
    // its own `waitUntil(flushPromise)` cycle that extends the function's
    // lifetime until the HTTP send completes. We don't need to await the
    // returned promise here — and awaiting one of `posthog-node`'s
    // immediate-send primitives doesn't reliably keep the Vercel isolate
    // alive (verified empirically across PRs #581–#585).
    client.captureException(err, distinctId, {
      $exception_source: 'instrumentation.onRequestError',
      path: request.path,
      method: request.method,
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
    })
  } catch {
    // Swallow — instrumentation must never crash a request.
  }
}

const POSTHOG_COOKIE_PREFIX = 'ph_'
const POSTHOG_COOKIE_SUFFIX = '_posthog'

/**
 * PostHog stores its persistence in a cookie named `ph_<token>_posthog`
 * with a JSON value containing `distinct_id`. This pulls the distinct id out
 * of the request cookie header. Returns `undefined` when the cookie is
 * missing or unparseable — the PostHog capture API accepts an undefined
 * distinct id and falls back to its server-side anonymous id.
 */
function extractDistinctIdFromCookie(
  cookieHeader: string | string[] | undefined,
): string | undefined {
  if (!cookieHeader) return undefined
  const raw = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader

  for (const cookie of raw.split(';')) {
    const eq = cookie.indexOf('=')
    if (eq === -1) continue
    const name = cookie.slice(0, eq).trim()
    if (!name.startsWith(POSTHOG_COOKIE_PREFIX) || !name.endsWith(POSTHOG_COOKIE_SUFFIX)) continue
    const rawValue = cookie.slice(eq + 1).trim()
    try {
      const parsed = JSON.parse(decodeURIComponent(rawValue)) as { distinct_id?: unknown }
      if (typeof parsed.distinct_id === 'string') return parsed.distinct_id
    } catch {
      // Malformed PostHog cookie — keep scanning; another cookie may parse.
      continue
    }
  }
  return undefined
}
