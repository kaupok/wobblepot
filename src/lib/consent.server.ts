import 'server-only'
import { cookies } from 'next/headers'
import { CONSENT_COOKIE_NAME, type ConsentDecision, parseConsentDecision } from '@/lib/consent'

export async function readConsentCookieServer(): Promise<ConsentDecision | null> {
  const store = await cookies()
  return parseConsentDecision(store.get(CONSENT_COOKIE_NAME)?.value)
}
