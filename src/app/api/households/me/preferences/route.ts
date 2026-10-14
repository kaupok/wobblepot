import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import {
  countConflictingPlannedEntries,
  updateHouseholdPreferences,
} from '@/lib/household/preferences'

/** The fields a planned meal can break; a save that sends one is counted (HON-1126). */
const FOOD_FIELDS = ['dietaryType', 'allergensToAvoid', 'excludedIngredients'] as const

const updatePreferencesSchema = z.object({
  dietaryType: z.enum(['vegetarian', 'vegan', 'pescatarian']).nullable().optional(),
  allergensToAvoid: z
    .array(
      z.enum(['gluten', 'dairy', 'eggs', 'nuts', 'peanuts', 'soy', 'fish', 'shellfish', 'sesame']),
    )
    .optional(),
  restrictions: z.array(z.string()).optional(),
  excludedIngredients: z.array(z.string()).optional(),
  excludedIngredientIds: z.array(z.string()).optional(),
  weekdayMealTypes: z
    .array(z.enum(['breakfast', 'lunch', 'dinner']))
    .min(1, 'At least one weekday meal type required')
    .optional(),
  weekendMealTypes: z
    .array(z.enum(['breakfast', 'lunch', 'dinner']))
    .min(1, 'At least one weekend meal type required')
    .optional(),
})

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

    if (!membership.household.preferences) {
      return NextResponse.json({ error: 'No household preferences found' }, { status: 404 })
    }

    return NextResponse.json(membership.household.preferences)
  } catch (error) {
    captureApiError(error, { route: '/api/households/me/preferences', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to fetch household preferences' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = updatePreferencesSchema.safeParse(body)

    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
    }

    const membership = await getHouseholdMembership(session.user.id)

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    if (membership.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only household owners can update preferences' },
        { status: 403 },
      )
    }

    // Resolves the excluded names to ingredient ids, and creates a missing
    // preferences row (HON-672, HON-889).
    const preferences = await updateHouseholdPreferences(membership.household.id, parsed.data)

    // A food save says how many planned meals now break the preferences, so
    // the toast can tell the household to look (HON-1126). It reads only: the
    // plan never changes by itself. The meal-types save sends no food field.
    // The preferences are stored by now, so a failed count is logged and the
    // save still succeeds: the cards are marked on Today either way.
    if (FOOD_FIELDS.some((field) => parsed.data[field] !== undefined)) {
      try {
        const conflictingEntries = await countConflictingPlannedEntries(
          membership.household,
          preferences,
        )
        return NextResponse.json({ ...preferences, conflictingEntries })
      } catch (error) {
        captureApiError(error, {
          route: '/api/households/me/preferences',
          userId: session.user.id,
          householdId: membership.household.id,
        })
      }
    }

    return NextResponse.json(preferences)
  } catch (error) {
    captureApiError(error, { route: '/api/households/me/preferences', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to update household preferences' }, { status: 500 })
  }
}
