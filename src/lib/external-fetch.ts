import 'server-only'
import { captureApiError, captureExternalApiTimeout } from '@/lib/errors'

export interface ExternalFetchContext {
  /** Logical feature making the call, e.g. `breached_password_check`. */
  feature: string
  /** Optional route name when called from a route handler. */
  route?: string
}

/**
 * Thin `fetch` wrapper for outbound calls to third-party HTTP APIs. Captures
 * non-2xx responses and network errors as PostHog events so we get a single
 * place to alert on "external dependency degraded" without flooding error
 * tracking from every individual route catch-block.
 *
 * Behaviour matches `fetch`:
 * - On a non-2xx response, the response is returned as-is. The caller still
 *   decides how to handle it (some callers may treat 4xx as a normal signal).
 * - On a thrown network error, the throw is captured and re-thrown unchanged.
 * - On a caller-initiated abort (`init.signal` aborted), the throw is re-thrown
 *   and recorded as an `external_api_timeout` analytics event rather than an
 *   exception — see `isCallerAbort` for why.
 *
 * This is for calls where a non-2xx is alert-worthy (Anthropic 500, Resend
 * 502, HIBP 503). Calls where 4xx is expected (e.g. user-supplied URL
 * validation) should use raw `fetch` directly.
 */
export async function externalFetch(
  input: string | URL,
  init: RequestInit | undefined,
  context: ExternalFetchContext,
): Promise<Response> {
  let response: Response
  try {
    response = await fetch(input, init)
  } catch (error) {
    if (isCallerAbort(init, error)) {
      captureExternalApiTimeout({
        ...context,
        $exception_source: 'externalFetch.timeout',
        url: redactUrl(input),
      })
      throw error
    }

    captureApiError(error, {
      ...context,
      $exception_source: 'externalFetch.networkError',
      url: redactUrl(input),
    })
    throw error
  }

  if (!response.ok) {
    captureApiError(new ExternalApiError(redactUrl(input), response.status), {
      ...context,
      $exception_source: 'externalFetch.nonOk',
      statusCode: response.status,
      url: redactUrl(input),
    })
  }

  return response
}

/**
 * True when the rejection is the caller's own deadline landing rather than a
 * network fault.
 *
 * Both halves matter. The signal says the caller asked to stop; the error name
 * says *this* rejection is that abort, not a genuine failure that happened to
 * race the deadline. Checking the signal alone would swallow a real connection
 * reset that arrived in the same tick as the timer.
 *
 * `controller.abort()` rejects fetch with `AbortError`; `AbortSignal.timeout()`
 * rejects with `TimeoutError`. Both are a deadline the caller chose, so both
 * count here. (`onRequestError` in `instrumentation.ts` takes the opposite line
 * on `TimeoutError` — an abort that escapes all the way to the framework was
 * nobody's deliberate control flow, so it stays an exception there.)
 *
 * Matched by duck-typed `name`, like `isFrameworkNoise` in `instrumentation.ts`.
 * `instanceof Error` would be wrong: fetch rejects with a `DOMException`, and
 * whether that inherits from `Error` is realm-dependent — true in Node, false
 * under jsdom.
 */
function isCallerAbort(init: RequestInit | undefined, error: unknown): boolean {
  if (!init?.signal?.aborted) return false
  if (typeof error !== 'object' || error === null) return false
  const { name } = error as { name?: unknown }
  return name === 'AbortError' || name === 'TimeoutError'
}

/**
 * Strip query params and fragments from a URL before sending to PostHog —
 * external APIs sometimes carry tokens or user identifiers in query strings.
 */
function redactUrl(input: string | URL): string {
  try {
    const url = typeof input === 'string' ? new URL(input) : input
    return `${url.origin}${url.pathname}`
  } catch {
    if (typeof input === 'string') {
      const idx = input.indexOf('?')
      return idx === -1 ? input : input.slice(0, idx)
    }
    return String(input)
  }
}

export class ExternalApiError extends Error {
  constructor(
    public readonly url: string,
    public readonly statusCode: number,
  ) {
    super(`External API ${url} returned ${statusCode}`)
    this.name = 'ExternalApiError'
  }
}
