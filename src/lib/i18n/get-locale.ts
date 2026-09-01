import { headers } from 'next/headers'
import { getSession, getCachedMembership } from '@/lib/session'
import { resolveLocale } from './resolve-locale'
import type { Locale } from './locales'

/**
 * Resolve the locale for the current server request.
 * Reads session + household locale + Accept-Language in a single place.
 */
export async function getLocale(): Promise<Locale> {
  const requestHeaders = await headers()
  const acceptLanguage = requestHeaders.get('accept-language')

  const session = await getSession()
  // `getCachedMembership` is the request-cached `household_member` read shared
  // with the root layout and the header, so calling it here adds no query.
  const householdLocale = session
    ? ((await getCachedMembership(session.user.id))?.household.locale ?? null)
    : null

  return resolveLocale({ householdLocale, acceptLanguage })
}
