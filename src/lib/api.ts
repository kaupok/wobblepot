/**
 * Error thrown by `apiFetch` for a non-OK response. Carries the HTTP status so
 * callers can branch on it (e.g. 404 → "not found" copy) instead of matching on
 * the message text, which varies per route.
 */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Fetches JSON and throws `ApiError` on a non-OK response. The error message is
 * the route's `error` field when it sends one, else `fallbackMessage` — pass the
 * localized "…failed" copy a mutation toasts, so a bodiless 500 never surfaces
 * as "Request failed: 500".
 */
export async function apiFetch<T>(
  url: string,
  init?: RequestInit,
  fallbackMessage?: string,
): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(body.error || fallbackMessage || `Request failed: ${res.status}`, res.status)
  }
  return res.json()
}
