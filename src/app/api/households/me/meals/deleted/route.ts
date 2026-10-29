import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { auth } from '@/lib/auth'
import { listRecentlyDeletedHouseholdMeals } from '@/lib/deleted-household-meals'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'

const ROUTE = '/api/households/me/meals/deleted'

/**
 * GET /api/households/me/meals/deleted
 *
 * The household's recipes deleted in the last 30 days, newest first, for the
 * Recently deleted section on the Recipes page (HON-1336). Each is `{ id,
 * name, deletedAt }`.
 */
export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const membership = await getHouseholdMembership(session.user.id)

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    const meals = await listRecentlyDeletedHouseholdMeals(membership.household.id)

    return NextResponse.json({ meals })
  } catch (error) {
    captureApiError(error, { route: ROUTE, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to fetch deleted recipes' }, { status: 500 })
  }
}
