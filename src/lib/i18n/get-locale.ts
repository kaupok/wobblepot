import { headers } from 'next/headers'
import { getSession } from '@/lib/session'
import { getHouseholdMembership } from '@/lib/household'
import { resolveLocale } from './resolve-locale'
import type { Locale } from './locales'

/**
 * Resolve the locale for the current server request.
 * Reads session + household membership + Accept-Language in a single place.
 */
export async function getLocale(): Promise<Locale> {
  const requestHeaders = await headers()
  const acceptLanguage = requestHeaders.get('accept-language')

  const session = await getSession()
  let householdLocale: string | null = null
  if (session) {
    const membership = await getHouseholdMembership(session.user.id)
    householdLocale = membership?.household.locale ?? null
  }

  return resolveLocale({ householdLocale, acceptLanguage })
}
