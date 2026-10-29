import { headers } from 'next/headers'
import { cache } from 'react'

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { type SignInAccount, toSignInAccounts } from '@/lib/sign-in-methods'

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }))

/**
 * The signed-in user's sign-in methods (HON-1158): one row per Better Auth
 * account, a password (`credential`) or Google. Without a session Better Auth
 * refuses the read and this rejects, so a caller that starts it before the
 * session check (the account page, HON-1455) must handle that rejection.
 */
export async function getSignInAccounts(): Promise<SignInAccount[]> {
  return toSignInAccounts(await auth.api.listUserAccounts({ headers: await headers() }))
}

/**
 * Single request-cached read of the caller's `household_member` row.
 *
 * The root layout, the header, and the locale resolver each need a different
 * fact about the same row (does it exist / its `householdId` / its household's
 * locale / its household's timezone, which the header's past-meals count
 * needs). Selecting them all here and routing every caller through one
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
    select: { householdId: true, household: { select: { locale: true, timezone: true } } },
  }),
)

export const getHasHousehold = cache(
  async (userId: string): Promise<boolean> => (await getCachedMembership(userId)) !== null,
)

export const getHouseholdIdForUser = cache(
  async (userId: string): Promise<string | null> =>
    (await getCachedMembership(userId))?.householdId ?? null,
)
