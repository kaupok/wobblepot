import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { auth } from '@/lib/auth'
import { restoreHouseholdMeal } from '@/lib/deleted-household-meals'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { HouseholdMealError } from '@/lib/household-meal-error'
import { getHouseholdMeal } from '@/lib/household-meals-read'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'

const ROUTE = '/api/households/me/meals/[id]/restore'

/**
 * POST /api/households/me/meals/[id]/restore
 *
 * Brings back one of the household's recipes deleted in the last 30 days
 * (HON-1336) and answers with the recipe, as `GET [id]` does. 404 for a recipe
 * that is not the household's or was deleted before the window, 409 for a
 * live one.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

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

    await restoreHouseholdMeal(membership.household.id, id)
    const meal = await getHouseholdMeal(
      membership.household.id,
      id,
      resolveHouseholdLocale(membership.household),
    )

    return NextResponse.json(meal)
  } catch (error) {
    if (error instanceof HouseholdMealError) {
      if (error.reason === 'mealNotDeleted') {
        return NextResponse.json({ error: 'Recipe is not deleted' }, { status: 409 })
      }
      return NextResponse.json({ error: 'Recipe not found' }, { status: 404 })
    }

    captureApiError(error, { route: ROUTE, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to restore recipe' }, { status: 500 })
  }
}
