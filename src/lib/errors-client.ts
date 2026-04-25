import { errorTypeOf, fingerprintFor } from '@/lib/errors-shared'

export interface ClientErrorContext {
  /** Next.js error digest, when available. */
  digest?: string
  [key: string]: unknown
}

/**
 * Capture an error from the client. Used by `error.tsx`, `global-error.tsx`,
 * and any client-side helper that catches in a non-throwing path.
 *
 * Lazy-imports `posthog-js` so this file stays out of the SSR bundle. Silently
 * no-ops when PostHog hasn't initialised (consent denied or env not configured).
 */
export async function captureClientError(
  error: unknown,
  context: ClientErrorContext = {},
): Promise<void> {
  try {
    const { default: posthog } = await import('posthog-js')
    if (!posthog.__loaded) return
    const properties: Record<string, unknown> = {
      ...context,
      errorType: errorTypeOf(error),
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
