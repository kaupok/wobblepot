import { redactUrlProperties, sanitizeEventProperties } from '@/lib/redact'

type CaptureResultLike = {
  properties: Record<string, unknown>
  $set?: Record<string, unknown>
  $set_once?: Record<string, unknown>
}

/**
 * Shared `before_send` for posthog-js init. Strips the query string and the
 * invite code from URL properties (HON-990), runs the universal PII
 * sanitiser, and re-stamps `properties.token` (HON-528: the redactor strips it
 * as a sensitive key, but posthog-js needs it on the event for ingest auth —
 * the token is the public NEXT_PUBLIC_ project key, already in the browser
 * bundle).
 *
 * posthog-js sends person properties as top-level `$set` / `$set_once`, and
 * `$set_once` carries `$initial_current_url`, so those get the URL redaction
 * too.
 *
 * Used by `PostHogProvider` and `app/global-error.tsx`. The latter inits
 * posthog-js itself when the root layout throws (the provider lives inside
 * the failed layout), so both callsites must apply the same sanitisation —
 * otherwise a re-init from the provider after `reset()` is a no-op and the
 * minimal global-error config sticks for the rest of the session.
 */
export function postHogBeforeSend<T extends CaptureResultLike>(cr: T | null): T | null {
  if (!cr) return cr
  const urlRedacted = redactUrlProperties(cr.properties)
  const sanitized = sanitizeEventProperties(urlRedacted) ?? urlRedacted
  if ('token' in cr.properties) {
    sanitized.token = cr.properties.token
  }
  const out: T = { ...cr, properties: sanitized }
  if (cr.$set) out.$set = redactUrlProperties(cr.$set)
  if (cr.$set_once) out.$set_once = redactUrlProperties(cr.$set_once)
  return out
}

/**
 * Query parameters posthog-js masks at the source, for both `posthog.init`
 * calls. `before_send` only sees captured events. The `/flags` request sends
 * `$initial_current_url` from persistence without going through it, so a
 * reset page's `?token=` or a sign-in page's `?returnUrl=/invite/<code>` would
 * reach PostHog that way. `custom_personal_data_properties` only applies when
 * `mask_personal_data_properties` is on, which also masks ad click ids.
 */
export const POSTHOG_URL_MASKING = {
  mask_personal_data_properties: true,
  custom_personal_data_properties: ['token', 'returnUrl'],
}
