export const CONSENT_COOKIE_NAME = 'consent-v1'
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

/**
 * Version of the Terms of Service + Privacy Policy a user agrees to at
 * sign-up (HON-457). Stored on `User.acceptedTermsVersion` alongside
 * `acceptedTermsAt`, stamped server-side in src/lib/auth.ts.
 *
 * Bump semantics: increment by 1 whenever the Terms or Privacy Policy
 * changes *materially* (new processor, new data category, changed legal
 * basis, changed retention) — not for typo/clarity edits. Users whose
 * stored version is below the current one can then be re-prompted at
 * session bootstrap (re-prompt flow is a follow-up issue; sign-up capture
 * is the minimum viable here). Update POLICY_LAST_UPDATED below in the
 * same PR as any bump — it drives the "Last updated" line on /privacy
 * and /terms and the sitemap lastModified for those routes (HON-559).
 */
export const CURRENT_TERMS_VERSION = 1

/**
 * ISO date (YYYY-MM-DD) of the last material change to the Terms of
 * Service / Privacy Policy. Single source of truth for the "Last
 * updated" line on /privacy and /terms and the sitemap `lastModified`
 * of those routes. Bump alongside CURRENT_TERMS_VERSION.
 */
export const POLICY_LAST_UPDATED = '2026-06-03'

/** Human-readable form of POLICY_LAST_UPDATED, e.g. "3 June 2026". */
export const POLICY_LAST_UPDATED_DISPLAY = new Date(POLICY_LAST_UPDATED).toLocaleDateString(
  'en-GB',
  { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' },
)

export type ConsentDecision = 'essential' | 'all'

export function parseConsentDecision(raw: string | undefined | null): ConsentDecision | null {
  return raw === 'essential' || raw === 'all' ? raw : null
}

export function decisionToGranted(decision: ConsentDecision | null): boolean | null {
  if (decision === null) return null
  return decision === 'all'
}

export function grantedToDecision(granted: boolean): ConsentDecision {
  return granted ? 'all' : 'essential'
}
