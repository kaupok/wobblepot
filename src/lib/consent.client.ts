import {
  CONSENT_COOKIE_MAX_AGE_SECONDS,
  CONSENT_COOKIE_NAME,
  type ConsentDecision,
  parseConsentDecision,
} from '@/lib/consent'

const LOCAL_STORAGE_KEY = 'consent-v1'

export function readConsentCookieClient(): ConsentDecision | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${CONSENT_COOKIE_NAME}=`))
  const raw = match ? match.slice(CONSENT_COOKIE_NAME.length + 1) : null
  return parseConsentDecision(raw)
}

export function writeConsentCookieClient(decision: ConsentDecision): void {
  if (typeof document === 'undefined') return
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${CONSENT_COOKIE_NAME}=${decision}; Path=/; Max-Age=${CONSENT_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, decision)
  } catch {
    // localStorage can throw in private-browsing / quota-exceeded states; cookie is source of truth.
  }
}
