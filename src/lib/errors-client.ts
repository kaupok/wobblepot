import { errorTypeOf, fingerprintFor } from '@/lib/errors-shared'
import { getLoadedPostHog } from '@/lib/posthog-client-state'

export interface ClientErrorContext {
  /** Next.js error digest, when available. */
  digest?: string
  [key: string]: unknown
}

/**
 * Capture an error from the client. Used by `error.tsx`, `global-error.tsx`,
 * and any client-side helper that catches in a non-throwing path.
 *
 * Lazy-imports `posthog-js` so this file stays out of the SSR bundle, and only
 * once PostHog has initialised. Silently no-ops when it hasn't (consent denied
 * or env not configured), without fetching the SDK chunk.
 */
export async function captureClientError(
  error: unknown,
  context: ClientErrorContext = {},
): Promise<void> {
  try {
    const posthog = await getLoadedPostHog()
    if (!posthog) return
    const properties: Record<string, unknown> = {
      ...context,
      // snake_case, the same key `captureApiError` sends for server errors.
      error_type: errorTypeOf(error),
    }
    const fingerprint = fingerprintFor(error)
    if (fingerprint) {
      properties.$exception_fingerprint = fingerprint
    }
    posthog.captureException(error, properties)
  } catch {
    // Swallow.
  }
}
