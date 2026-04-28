import { sanitizeEventProperties } from '@/lib/redact'

type CaptureResultLike = {
  properties: Record<string, unknown>
}

/**
 * Shared `before_send` for posthog-js init. Runs the universal PII sanitiser
 * and re-stamps `properties.token` (HON-528: the redactor strips it as a
 * sensitive key, but posthog-js needs it on the event for ingest auth — the
 * token is the public NEXT_PUBLIC_ project key, already in the browser bundle).
 *
 * Used by `PostHogProvider` and `app/global-error.tsx`. The latter inits
 * posthog-js itself when the root layout throws (the provider lives inside
 * the failed layout), so both callsites must apply the same sanitisation —
 * otherwise a re-init from the provider after `reset()` is a no-op and the
 * minimal global-error config sticks for the rest of the session.
 */
export function postHogBeforeSend<T extends CaptureResultLike>(cr: T | null): T | null {
  if (!cr) return cr
  const sanitized = sanitizeEventProperties(cr.properties) ?? cr.properties
  if ('token' in cr.properties) {
    sanitized.token = cr.properties.token
  }
  return { ...cr, properties: sanitized }
}
