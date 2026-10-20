import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { loadRecentMeals } from '@/lib/meal-plans/recent-meals'
import { captureApiError } from '@/lib/errors'

/**
 * GET /api/entries/recent
 *
 * The recipe meals the household completed in the last days of its own day,
 * which the fridge-meal picker offers as leftovers (HON-1277). The window and
 * the read live in `loadRecentMeals`.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const membership = await getHouseholdMembership(session.user.id)
  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const { household } = membership
  try {
    const meals = await loadRecentMeals(household)
    return NextResponse.json({ meals }, { status: 200 })
  } catch (error) {
    captureApiError(error, {
      route: '/api/entries/recent',
      userId: session.user.id,
      householdId: household.id,
    })
    return NextResponse.json({ error: 'Failed to fetch recent meals' }, { status: 500 })
  }
}
