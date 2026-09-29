import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'
import { getLocale } from '@/lib/i18n/get-locale'
import { captureApiError } from '@/lib/errors'

/**
 * GET /api/shopping-list
 *
 * Get shopping list for a rolling window of days from today.
 * Aggregates ingredients across all meal plans that fall within the window.
 * The read itself lives in `loadShoppingList`, which the pages call directly.
 *
 * Query params:
 * - days: 7 or 14 (default: 7)
 */
export async function GET(request: NextRequest) {
  // Auth check
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get household membership
  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const { household } = membership

  // Parse and validate days param
  const daysParam = request.nextUrl.searchParams.get('days')
  const days = daysParam ? parseInt(daysParam, 10) : 7

  if (days !== 7 && days !== 14) {
    return NextResponse.json({ error: 'Invalid days parameter. Must be 7 or 14.' }, { status: 400 })
  }

  try {
    const locale = await getLocale()
    const response = await loadShoppingList(household, { days, locale })
    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    captureApiError(error, { route: '/api/shopping-list', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to fetch shopping list' }, { status: 500 })
  }
}
