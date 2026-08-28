/**
 * Next.js instrumentation hook. The `onRequestError` export is the safety net
 * for any error that escapes a route's try/catch — uncaught throws in RSCs,
 * middleware, and API routes — and ensures it lands in PostHog with at least
 * a distinct id derived from the PostHog cookie.
 *
 * Per-route helpers in `src/lib/errors.ts` add richer context (route literal,
 * householdId, feature). This hook is the floor, not the ceiling.
 *
 * It captures only genuine faults. It drops Next.js framework noise (aborted
 * RSC-prefetch streams, redirect/not-found control-flow throws) and every
 * error from a local dev server, so the shared project stays clean.
 *
 * Runs only in the Node.js runtime; the edge runtime cannot use the
 * `posthog-node` SDK and is a no-op here.
 *
 * **File location matters.** The Next.js docs say `instrumentation.ts` may
 * live at the project root *or* at `src/instrumentation.ts`. Empirically on
 * Next.js 16 + Turbopack + Vercel, only `src/` is loaded into Node-runtime
 * serverless functions — a root-level file gets bundled but never executed,
 * silently dropping every `onRequestError` event. PRs #581–#586 each shipped
 * a different "fix" for HON-533 with the file at the root and none of them
 * ever ran on Node. Keep this file in `src/`.
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

  // Skip local dev servers. Their errors pollute the shared project and fire
  // first-seen alerts, which trains the team to ignore those alerts.
  const release = process.env.VERCEL_GIT_COMMIT_SHA ?? 'local'
  if (release === 'local') return

  // Skip framework noise: aborted-stream throws from cancelled RSC prefetches,
  // and Next's redirect/not-found control-flow throws. Neither is a real fault.
  if (isFrameworkNoise(err)) return

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
      release,
    })
  } catch {
    // Swallow — instrumentation must never crash a request.
  }
}

// Aborted-stream throws Next.js raises when the browser cancels an in-flight
// RSC prefetch (navigation, hot reload). Matched by message substring, error
// name, or Node stream error code.
const ABORTED_STREAM_MESSAGES = [
  'The destination stream closed early',
  'ERR_STREAM_PREMATURE_CLOSE',
]

// Next.js digest prefixes for `redirect()` and `notFound()`. These are
// control-flow throws the framework catches itself, not errors.
const NEXT_CONTROL_FLOW_DIGESTS = ['NEXT_REDIRECT', 'NEXT_NOT_FOUND']

/**
 * True when the error is Next.js framework noise rather than an application
 * fault — a cancelled RSC prefetch or a redirect/not-found control-flow throw.
 */
function isFrameworkNoise(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false

  const { name, message, code, digest } = err as {
    name?: unknown
    message?: unknown
    code?: unknown
    digest?: unknown
  }

  if (name === 'AbortError') return true
  if (code === 'ERR_STREAM_PREMATURE_CLOSE') return true

  if (typeof digest === 'string') {
    for (const prefix of NEXT_CONTROL_FLOW_DIGESTS) {
      if (digest === prefix || digest.startsWith(`${prefix};`)) return true
    }
  }

  if (typeof message === 'string') {
    for (const needle of ABORTED_STREAM_MESSAGES) {
      if (message.includes(needle)) return true
    }
  }

  return false
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
