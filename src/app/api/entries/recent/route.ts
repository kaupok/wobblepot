import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { sumPortions } from '@/lib/meal-planning/servings'
import { loadLeftoverSources } from '@/lib/meal-plans/recent-meals'

const slotSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  mealType: z.enum(['breakfast', 'lunch', 'dinner']),
})

/**
 * GET /api/entries/recent?date=YYYY-MM-DD&mealType=lunch
 *
 * The recipe meals a fridge meal in this slot can take leftovers from, planned
 * or cooked, which the fridge-meal picker offers (HON-1277, HON-1396). The rule
 * lives in `loadLeftoverSources`. `defaultServings` is the household's own
 * servings, where a planned source's servings control starts.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const membership = await getHouseholdMembership(session.user.id)
  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const params = new URL(request.url).searchParams
  const parsed = slotSchema.safeParse({
    date: params.get('date'),
    mealType: params.get('mealType'),
  })
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors
    return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
  }

  const { household } = membership
  try {
    const meals = await loadLeftoverSources(household, parsed.data)
    return NextResponse.json(
      { meals, defaultServings: sumPortions(household.members) },
      { status: 200 },
    )
  } catch (error) {
    captureApiError(error, {
      route: '/api/entries/recent',
      userId: session.user.id,
      householdId: household.id,
    })
    return NextResponse.json({ error: 'Failed to fetch recent meals' }, { status: 500 })
  }
}
