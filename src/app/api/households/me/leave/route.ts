import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { runHouseholdClaim } from '@/lib/household-claim'
import {
  afterHouseholdLeft,
  leaveHousehold,
  NotInHouseholdError,
  OwnerHasOtherAccountsError,
} from '@/lib/household-leave'
import { captureApiError } from '@/lib/errors'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'

const ROUTE = '/api/households/me/leave'

/**
 * Leave the signed-in user's household (HON-1133). A member's row is deleted;
 * the sole account holder's household is deleted with everything in it. See
 * `leaveHousehold` for the rules.
 *
 * Runs through `runHouseholdClaim` so it takes the same per-user lock as a
 * join or onboarding, and a leave cannot interleave with either.
 */
export async function POST() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id

  // Shared with "Leave and join" on the join route: leaving and onboarding
  // again would reset the household's AI spend cap (`household-leave`).
  const rateLimit = await checkRateLimit(userId, 'household-leave')
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', resetAt: rateLimit.resetAt.toISOString() },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds(rateLimit)) } },
    )
  }

  try {
    const result = await runHouseholdClaim(userId, (tx) => leaveHousehold(tx, userId))
    await afterHouseholdLeft(result, { route: ROUTE, userId })

    return NextResponse.json({ deletedHousehold: result.deletedHousehold })
  } catch (error) {
    if (error instanceof NotInHouseholdError) {
      return NextResponse.json({ error: 'no_household' }, { status: 404 })
    }

    if (error instanceof OwnerHasOtherAccountsError) {
      return NextResponse.json(
        { error: 'owner_has_other_accounts', count: error.otherAccountCount },
        { status: 409 },
      )
    }

    captureApiError(error, { route: ROUTE, userId })
    return NextResponse.json({ error: 'Failed to leave household' }, { status: 500 })
  }
}
