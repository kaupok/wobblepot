import 'server-only'
import { after } from 'next/server'
import { getPosthogServer } from '@/lib/posthog-server'
import { getRequestId } from '@/lib/request-id'
import { errorTypeOf, fingerprintFor } from '@/lib/errors-shared'

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
 * - Reads `requestId` from `AsyncLocalStorage` so callers don't have to
 *   thread it through every layer.
 * - Reads `release` from `VERCEL_GIT_COMMIT_SHA` so the dashboard can pivot
 *   on deploy.
 * - Adds a stable `$exception_fingerprint` for typed errors we throw
 *   ourselves.
 * - Silently no-ops when PostHog is not configured (local dev with no key).
 * - Never throws — a PostHog failure must not propagate up the route handler.
 */
export function captureApiError(error: unknown, context: ApiErrorContext): void {
  try {
    const client = getPosthogServer()
    if (!client) return

    const properties: Record<string, unknown> = {
      ...context,
      requestId: getRequestId(),
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
      errorType: errorTypeOf(error),
    }

    const fingerprint = fingerprintFor(error)
    if (fingerprint) {
      properties.$exception_fingerprint = fingerprint
    }

    client.captureException(error, context.userId, properties)
    // Vercel isolates terminate on response — extend lifetime so the async flush completes.
    after(() => client.flush())
  } catch {
    // Swallow — capture failures must never propagate.
  }
}
