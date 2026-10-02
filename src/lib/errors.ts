import 'server-only'
import { after } from 'next/server'
import { getPosthogServer } from '@/lib/posthog-server'
import { getRequestId } from '@/lib/request-id'
import { errorTypeOf, fingerprintFor } from '@/lib/errors-shared'
import { getRelease, shouldSkipLocalCapture } from '@/lib/release'

export interface ApiErrorContext {
  /** Static route literal, e.g. `/api/meal-plans/generate`. Omitted for
   *  errors caught outside a route handler (e.g. `externalFetch`). */
  route?: string
  /** Authenticated user id; used as PostHog `distinct_id` so server errors
   *  attribute to the same person record as the client's `posthog.identify`
   *  call (see `PostHogProvider.tsx`). Omitted for unauthenticated paths. */
  userId?: string
  /** Optional household id; surfaced as a property for filtering rather
   *  than as the distinct_id, to keep server/client identity consistent. */
  householdId?: string
  /** AI feature name when applicable (matches `AiUsage.feature`). */
  feature?: string
  /** Status code from an external API when this is a wrapped non-2xx. */
  statusCode?: number
  /** Free-form extras — keep keys non-PII; sanitiser is the safety net. */
  [key: string]: unknown
}

/**
 * Capture an error from a server route handler / RSC / lib function.
 *
 * - Reads `request_id` from `AsyncLocalStorage` so callers don't have to
 *   thread it through every layer.
 * - Sends every property key in snake_case (`user_id`, `household_id`,
 *   `status_code`), matching product events and `$ai_generation`, so one
 *   `household_id` filter covers both. Callers keep camelCase context keys.
 * - Tags `$exception_source: 'captureApiError'` unless the caller set one,
 *   so route-caught errors are not the one untagged group.
 * - Reads `release` from `VERCEL_GIT_COMMIT_SHA` so the dashboard can pivot
 *   on deploy.
 * - Adds a stable `$exception_fingerprint` for typed errors we throw
 *   ourselves.
 * - Skips local machines (see `shouldSkipLocalCapture`), matching
 *   `onRequestError`, so their errors never reach the shared project.
 * - Silently no-ops when PostHog is not configured (local dev with no key).
 * - Never throws — a PostHog failure must not propagate up the route handler.
 */
export function captureApiError(error: unknown, context: ApiErrorContext): void {
  try {
    if (shouldSkipLocalCapture()) return

    const client = getPosthogServer()
    if (!client) return

    const properties: Record<string, unknown> = {
      $exception_source: 'captureApiError',
      ...toSnakeCaseKeys(context),
      request_id: getRequestId(),
      release: getRelease(),
      error_type: errorTypeOf(error),
    }

    const fingerprint = fingerprintFor(error)
    if (fingerprint) {
      properties.$exception_fingerprint = fingerprint
    }

    client.captureException(error, context.userId, properties)
    try {
      // Vercel isolates terminate on response — extend lifetime so the async flush completes.
      after(() => client.flush())
    } catch {
      // Outside a request scope (e.g. background script) — capture is queued; long-lived
      // processes flush on posthog-node's interval, serverless ones drop and that's fine.
    }
  } catch {
    // Swallow — capture failures must never propagate.
  }
}

/**
 * Record an external dependency exceeding a deadline its caller set.
 *
 * Deliberately *not* an exception. The caller chose the deadline and handles
 * the miss (the HIBP check fails open), so an `$exception` would fire a
 * first-seen alert nobody can act on. But a third party that hangs past its
 * deadline is the same "dependency degraded" signal as the 503 `externalFetch`
 * does capture — dropping it outright would make an outage that manifests as
 * slowness completely invisible. An analytics event keeps it queryable and
 * alertable on a rate, without entering error tracking.
 *
 * Callers tag themselves with a plain `source` property rather than the
 * `$exception_source` used on capture paths — the `$`-prefixed key belongs to
 * PostHog's exception schema and would misfile this as an error.
 *
 * Per-request flush is the SDK's job (`flushAt: 1` + `waitUntil` in
 * `posthog-server.ts`), matching the `$ai_generation` mirror in `ai/usage.ts`.
 */
export function captureExternalApiTimeout(context: ApiErrorContext): void {
  try {
    if (shouldSkipLocalCapture()) return

    const client = getPosthogServer()
    if (!client) return

    client.capture({
      // Infrastructure health, not a user action. Without a user the event is
      // personless: a request id as distinct id minted one person per timeout.
      // `request_id` still joins it to the rest of that request's events.
      distinctId: context.userId,
      event: 'external_api_timeout',
      properties: {
        ...toSnakeCaseKeys(context),
        request_id: getRequestId(),
        release: getRelease(),
        ...(!context.userId && { $process_person_profile: false }),
      },
    })
  } catch {
    // Swallow — capture failures must never propagate.
  }
}

/**
 * `userId` → `user_id`. `$`-prefixed keys belong to PostHog's schema and pass
 * through unchanged; already snake_case keys are left as they are.
 */
function toSnakeCaseKeys(context: ApiErrorContext): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key.startsWith('$') ? key : key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase(),
      value,
    ]),
  )
}
