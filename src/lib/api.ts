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

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(body.error || `Request failed: ${res.status}`, res.status)
  }
  return res.json()
}
