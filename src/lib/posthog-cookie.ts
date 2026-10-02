/**
 * Read the browser's PostHog identity from a request, so a server event can
 * join the browser session that caused it (HON-998).
 *
 * posthog-js persists to a cookie named `ph_<token>_posthog` whose JSON value
 * holds `distinct_id` and `$sesid: [lastActivityTimestamp, sessionId,
 * sessionStartTimestamp]`. The cookie exists only after the user consents
 * (`PostHogProvider` does not load posthog-js before), so a request without
 * consent yields nothing here.
 *
 * Dependency-free apart from `redact.ts`: `instrumentation.ts` imports it
 * statically and must stay out of `posthog-node` and `next/headers`.
 */
import { redactUrlValue } from '@/lib/redact'

const POSTHOG_COOKIE_PREFIX = 'ph_'
const POSTHOG_COOKIE_SUFFIX = '_posthog'

type HeaderValue = string | string[] | null | undefined

export interface PosthogCookie {
  distinctId?: string
  sessionId?: string
}

/** The properties a server event needs to join a browser session. */
export interface ClientSessionProperties {
  $session_id?: string
  $current_url?: string
}

function headerString(value: HeaderValue, separator: string): string | undefined {
  if (!value) return undefined
  return Array.isArray(value) ? value.join(separator) : value
}

/**
 * Pull `distinct_id` and the session id out of the PostHog cookie in a
 * `Cookie` header. Each field is `undefined` when the cookie is missing,
 * unparseable or lacks it.
 */
export function parsePosthogCookie(cookieHeader: HeaderValue): PosthogCookie {
  const raw = headerString(cookieHeader, '; ')
  if (!raw) return {}

  for (const cookie of raw.split(';')) {
    const eq = cookie.indexOf('=')
    if (eq === -1) continue
    const name = cookie.slice(0, eq).trim()
    if (!name.startsWith(POSTHOG_COOKIE_PREFIX) || !name.endsWith(POSTHOG_COOKIE_SUFFIX)) continue
    try {
      const parsed = JSON.parse(decodeURIComponent(cookie.slice(eq + 1).trim())) as {
        distinct_id?: unknown
        $sesid?: unknown
      }
      const rawSessionId = Array.isArray(parsed.$sesid) ? parsed.$sesid[1] : undefined
      const distinctId = typeof parsed.distinct_id === 'string' ? parsed.distinct_id : undefined
      const sessionId = typeof rawSessionId === 'string' && rawSessionId ? rawSessionId : undefined
      if (distinctId || sessionId) return { distinctId, sessionId }
    } catch {
      // Malformed PostHog cookie — keep scanning; another cookie may parse.
    }
  }
  return {}
}

/**
 * `$current_url` from the `Referer` header, which for a `fetch` from a page is
 * that page's URL. Only a same-origin Referer counts: a cross-origin one names
 * another site, not the page the user is on. The value goes through
 * `redactUrlValue`, so a reset token or invite code never reaches PostHog this
 * way (HON-990).
 */
function currentUrlFrom(referer: HeaderValue, host: HeaderValue): string | undefined {
  const refererValue = headerString(referer, ',')
  const hostValue = headerString(host, ',')
  if (!refererValue || !hostValue) return undefined
  try {
    if (new URL(refererValue).host !== hostValue) return undefined
  } catch {
    return undefined
  }
  return redactUrlValue(refererValue)
}

/**
 * `$session_id` and `$current_url` for a server event, from the request's
 * `Cookie`, `Referer` and `Host` headers. Keys without a value are omitted, so
 * the result can be spread into event properties as is.
 */
export function clientSessionProperties(headers: {
  cookie: HeaderValue
  referer: HeaderValue
  host: HeaderValue
}): ClientSessionProperties {
  const { sessionId } = parsePosthogCookie(headers.cookie)
  const currentUrl = currentUrlFrom(headers.referer, headers.host)
  return {
    ...(sessionId && { $session_id: sessionId }),
    ...(currentUrl && { $current_url: currentUrl }),
  }
}
