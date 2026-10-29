import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { loadMealPlan, MealPlanReadError, type MealPlanReadRefusal } from '@/lib/meal-plans/plans'

/** The answer to each refusal from `loadMealPlan`; see `MealPlanReadRefusal`. */
const REFUSALS: Record<MealPlanReadRefusal, { status: number; error: string }> = {
  planNotFound: { status: 404, error: 'Meal plan not found' },
  otherHousehold: { status: 403, error: 'Access denied to this meal plan' },
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  // Resolved: a locale rolled back out of KNOWN_LOCALES reads as English (HON-921).
  const locale = resolveHouseholdLocale(household)

  // Extract plan ID from params
  const { id } = await params

  try {
    return NextResponse.json(await loadMealPlan(household.id, id, locale), { status: 200 })
  } catch (error) {
    if (error instanceof MealPlanReadError) {
      const { status, error: message } = REFUSALS[error.reason]
      return NextResponse.json({ error: message }, { status })
    }

    captureApiError(error, { route: '/api/meal-plans/[id]', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to fetch meal plan' }, { status: 500 })
  }
}
