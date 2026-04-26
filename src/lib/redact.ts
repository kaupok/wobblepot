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
