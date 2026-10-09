import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { findSynonym } from '@/lib/ingredient-aliases'
import { countConflictingPlannedEntries } from '@/lib/meal-planning/count-preference-conflicts'

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

    // Resolve excluded ingredient names to IDs for filtering. Global and this
    // household's own ingredients only: the ids are returned in the response,
    // so matching another household's would reveal them (HON-889).
    let excludedIngredientIds: string[] | undefined
    if (parsed.data.excludedIngredients) {
      // A name saved before a rename or merge is now another English name for
      // a pool row ("shrimp" for prawns, HON-1097), so look up its pool name
      // too, or a re-save drops the exclusion. Synonyms only: an alias narrows
      // a word ("beef" → beef mince) and would exclude less than was typed.
      const names = parsed.data.excludedIngredients.flatMap((name) => {
        const poolName = findSynonym(name)
        return poolName ? [name, poolName] : [name]
      })
      const ingredients = await prisma.ingredient.findMany({
        where: {
          name: {
            in: names,
            mode: 'insensitive',
          },
          OR: [{ householdId: null }, { householdId: membership.household.id }],
        },
        select: { id: true },
      })
      excludedIngredientIds = ingredients.map((i) => i.id)
    }

    const preferencesData = {
      ...parsed.data,
      ...(excludedIngredientIds !== undefined && { excludedIngredientIds }),
    }

    // Upsert, not update: a household whose preferences row is missing self-heals
    // on first save instead of returning 500 on Prisma's P2025 (HON-672).
    const preferences = await prisma.householdPreferences.upsert({
      where: { householdId: membership.household.id },
      update: preferencesData,
      create: { householdId: membership.household.id, ...preferencesData },
    })

    // A food save says how many planned meals now break the preferences, so
    // the toast can tell the household to look (HON-1126). It reads only: the
    // plan never changes by itself. The meal-types save sends no food field.
    if (FOOD_FIELDS.some((field) => parsed.data[field] !== undefined)) {
      const conflictingEntries = await countConflictingPlannedEntries(
        membership.household,
        preferences,
      )
      return NextResponse.json({ ...preferences, conflictingEntries })
    }

    return NextResponse.json(preferences)
  } catch (error) {
    captureApiError(error, { route: '/api/households/me/preferences', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to update household preferences' }, { status: 500 })
  }
}
