export const CONSENT_COOKIE_NAME = 'consent-v1'
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

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
