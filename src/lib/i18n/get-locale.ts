import { cache } from 'react'
import { headers } from 'next/headers'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { resolveLocale } from './resolve-locale'
import type { Locale } from './locales'

// Narrow, request-cached lookup so calling `getLocale()` in the root layout
// doesn't duplicate the `getHouseholdMembership` join that every authenticated
// page already runs. Only `household.locale` is read.
const getCachedHouseholdLocale = cache(async (userId: string): Promise<string | null> => {
  const row = await prisma.householdMember.findFirst({
    where: { userId },
    select: { household: { select: { locale: true } } },
  })
  return row?.household.locale ?? null
})

/**
 * Resolve the locale for the current server request.
 * Reads session + household locale + Accept-Language in a single place.
 */
export async function getLocale(): Promise<Locale> {
  const requestHeaders = await headers()
  const acceptLanguage = requestHeaders.get('accept-language')

  const session = await getSession()
  const householdLocale = session ? await getCachedHouseholdLocale(session.user.id) : null

  return resolveLocale({ householdLocale, acceptLanguage })
}
