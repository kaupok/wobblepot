import { RetryError } from 'ai'

/**
 * The HTTP status a failed AI call reported, if any.
 *
 * ai@7 wraps the provider's `APICallError` in a `RetryError` once a call with
 * `maxRetries > 0` has retried at least once, and the wrapper carries no
 * status of its own — so a 429 that outlasted its retries, the case a route
 * most needs to recognise, read as "no status" and fell through to a 500
 * (HON-735 review). The status lives on `lastError`.
 */
export function aiErrorStatusCode(error: unknown): number | undefined {
  const cause = RetryError.isInstance(error) ? error.lastError : error
  if (cause !== null && typeof cause === 'object') {
    const e = cause as Record<string, unknown>
    if (typeof e['statusCode'] === 'number') return e['statusCode']
    if (typeof e['status'] === 'number') return e['status']
  }
  return undefined
}
