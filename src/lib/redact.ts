/**
 * PII scrubbing utilities used by error capture, analytics events, and any
 * other code path that ships user-touched data to a third party.
 *
 * Two layers of defence:
 * 1. `sanitizeEventProperties` strips known-sensitive keys and redacts
 *    known-free-text keys. Wired into PostHog's `before_send` hook so it
 *    fires for every captured event, including ones a future caller forgot
 *    to redact.
 * 2. `redactFreeText` is the per-call helper for callers that explicitly
 *    know they're handling user-authored free text.
 *
 * URLs are a third case. `redactUrlProperties` strips the query string and
 * the invite code from the URL-valued properties the SDKs stamp themselves,
 * because a password-reset link carries its token in `?token=` and an invite
 * link carries its code in the path (HON-990).
 *
 * The universal PII policy is HON-474 Decision 10 — never send email,
 * password, tokens, names, or invite codes; redact raw free text.
 */

const SENSITIVE_KEYS_LOWER = new Set([
  'email',
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'sessiontoken',
  'authtoken',
  'apikey',
  'firstname',
  'lastname',
  'fullname',
  'displayname',
  'username',
  'invitecode',
])

const FREE_TEXT_KEYS_LOWER = new Set([
  'notes',
  'description',
  'prompt',
  'feedback',
  'comment',
  'query',
  'searchquery',
  'userinput',
])

const TRUNCATE_LENGTH = 20

/**
 * Truncate a free-text string to the first 20 chars, append a stable hash
 * suffix so support can correlate redactions back to the same source string.
 */
export function redactFreeText(s: string): string {
  if (!s) return s
  return `${s.slice(0, TRUNCATE_LENGTH)}…[h:${fnv1aHex(s)}]`
}

/**
 * Properties whose value is a URL or a path. posthog-js stamps the
 * `$current_url` / `$pathname` / `$referrer` set on every event, copies them
 * into `$session_entry_*` on every event and into `$initial_*` on the person
 * (`$set_once`). `path` and `url` are our own server-side keys
 * (`instrumentation.ts`, `external-fetch.ts`).
 */
const URL_KEYS = new Set([
  '$current_url',
  '$pathname',
  '$referrer',
  '$prev_pageview_pathname',
  '$session_entry_url',
  '$session_entry_pathname',
  '$session_entry_referrer',
  '$initial_current_url',
  '$initial_pathname',
  '$initial_referrer',
  'path',
  'url',
])

const PERSON_PROPERTY_KEYS = ['$set', '$set_once'] as const

// The path segment that holds an invite code. `/api/households/me/invites/<id>`
// is a database id, not a secret, so it is not matched.
const SECRET_PATH_SEGMENT = /(^|\/)(invite|api\/invites)\/[^/]+/g

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i

function redactPath(path: string): string {
  return path.replace(SECRET_PATH_SEGMENT, '$1$2/:code')
}

/**
 * Drop the query string and fragment from a URL or path and replace an invite
 * code in the path with `:code`. Keeps the origin and the rest of the path,
 * which web analytics needs. A value that is not a URL (`$direct`) passes
 * through unchanged.
 */
export function redactUrlValue(url: string): string {
  if (ABSOLUTE_URL.test(url)) {
    try {
      const parsed = new URL(url)
      if (parsed.origin !== 'null') return `${parsed.origin}${redactPath(parsed.pathname)}`
    } catch {
      // Fall through to the string path below.
    }
  }
  const end = url.search(/[?#]/)
  return redactPath(end === -1 ? url : url.slice(0, end))
}

function redactUrlKeys(properties: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...properties }
  for (const key of URL_KEYS) {
    const value = out[key]
    if (typeof value === 'string') out[key] = redactUrlValue(value)
  }
  return out
}

/**
 * Apply `redactUrlValue` to every URL-valued property, including the person
 * properties nested under `$set` / `$set_once`. Run it before
 * `sanitizeEventProperties`, which passes `$`-prefixed keys through untouched.
 *
 * Pure: returns a new object, never mutates input.
 */
export function redactUrlProperties<T extends Record<string, unknown> | undefined>(
  properties: T,
): T {
  if (!properties) return properties
  const out = redactUrlKeys(properties)
  for (const key of PERSON_PROPERTY_KEYS) {
    const nested = out[key]
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      out[key] = redactUrlKeys(nested as Record<string, unknown>)
    }
  }
  return out as T
}

/**
 * Walk an event-properties object and remove or redact any PII-shaped keys.
 * PostHog-internal keys (prefixed with `$`) are left alone — those are owned
 * by the SDK, not by our captures.
 *
 * Pure: returns a new object, never mutates input.
 *
 * GOTCHA — posthog-js stamps the project token at `properties.token` (no `$`
 * prefix) inside `calculateEventProperties`. The PostHog ingest authenticates
 * by reading `api_key` or `token` from the request body, so an event without
 * either is rejected with `401 "event submitted without an api_key"`. This
 * sanitizer strips `'token'` as a sensitive key — which is the right policy
 * for arbitrary `captureException` payloads where users could attach an
 * OAuth token to a thrown error — but it means the `before_send` callsite
 * MUST re-add `properties.token` after sanitization, otherwise every client
 * event 401s. See `src/components/PostHogProvider.tsx` for the restoration.
 * `posthog-node` is unaffected: it adds `api_key` at the envelope level
 * after `before_send` runs, so a stripped `properties.token` is harmless
 * server-side.
 */
export function sanitizeEventProperties(
  properties: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!properties) return properties

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(properties)) {
    if (key.startsWith('$')) {
      out[key] = value
      continue
    }
    const keyLower = key.toLowerCase()
    if (SENSITIVE_KEYS_LOWER.has(keyLower)) continue
    if (FREE_TEXT_KEYS_LOWER.has(keyLower) && typeof value === 'string') {
      out[key] = redactFreeText(value)
      continue
    }
    out[key] = value
  }
  return out
}

/**
 * 32-bit FNV-1a hash, returned as a zero-padded 8-char hex string. Sync,
 * cross-runtime, and stable across calls — exactly what redaction needs.
 *
 * Not a cryptographic hash. Used only so two redacted strings from the same
 * source produce the same suffix for support correlation.
 */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
