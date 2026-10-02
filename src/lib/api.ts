/**
 * Error thrown by `apiFetch` for a non-OK response. Carries the HTTP status so
 * callers can branch on it (e.g. 404 → "not found" copy) instead of matching on
 * the message text, which varies per route.
 *
 * `code` is the route's machine-readable `code` field, when it sends one — the
 * key a caller localizes from, since the route's `error` / `message` prose is
 * English (HON-697, HON-700, HON-725). `body` is the whole parsed error body,
 * or `{}` when it was not JSON, for callers that branch on another field or
 * keep the prose as a console breadcrumb. A body that is JSON but not an object
 * (`null`, a string) is also `{}`, so a caller can read a field off it safely.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly body: unknown

  constructor(
    message: string,
    status: number,
    { code, body = {} }: { code?: string; body?: unknown } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

/**
 * The `ApiError` for a non-OK response, read from its JSON body as `apiFetch`
 * reads it. Exported for a caller that cannot use `apiFetch` because the
 * success body is not JSON, such as a streamed answer (HON-979).
 */
export async function toApiError(res: Response, fallbackMessage?: string): Promise<ApiError> {
  const parsed: unknown = await res.json().catch(() => ({}))
  const body: Record<string, unknown> =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  const error = typeof body.error === 'string' ? body.error : undefined
  return new ApiError(error || fallbackMessage || `Request failed: ${res.status}`, res.status, {
    code: typeof body.code === 'string' ? body.code : undefined,
    body,
  })
}

/**
 * Fetches JSON and throws `ApiError` on a non-OK response. The error message is
 * the route's `error` field when it sends one, else `fallbackMessage` — pass the
 * localized "…failed" copy a mutation toasts, so a bodiless 500 never surfaces
 * as "Request failed: 500".
 *
 * A 204 or 205 resolves to `undefined` rather than failing to parse an empty
 * body — call it as `apiFetch<void>(…)`. Every bodyless route here answers 204.
 */
export async function apiFetch<T>(
  url: string,
  init?: RequestInit,
  fallbackMessage?: string,
): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw await toApiError(res, fallbackMessage)
  if (res.status === 204 || res.status === 205) return undefined as T
  return res.json()
}
