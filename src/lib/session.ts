import { cache } from 'react'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }))

/**
 * Single request-cached read of the caller's `household_member` row.
 *
 * The root layout, the header, and the locale resolver each need a different
 * fact about the same row (does it exist / its `householdId` / its household's
 * locale). Selecting all three here and routing every caller through one
 * `cache()` entry means React dedupes them into a single query per request —
 * previously they issued three separate `findFirst`/`count` calls, and the
 * layout's two-stage `Promise.all` made two of them strictly serial.
 *
 * Only these narrow columns are read; use `getHouseholdMembership` from
 * `@/lib/household` when the full household record is needed.
 */
export const getCachedMembership = cache(async (userId: string) =>
  prisma.householdMember.findFirst({
    where: { userId },
    select: { householdId: true, household: { select: { locale: true } } },
  }),
)

export const getHasHousehold = cache(
  async (userId: string): Promise<boolean> => (await getCachedMembership(userId)) !== null,
)

export const getHouseholdIdForUser = cache(
  async (userId: string): Promise<string | null> =>
    (await getCachedMembership(userId))?.householdId ?? null,
)
