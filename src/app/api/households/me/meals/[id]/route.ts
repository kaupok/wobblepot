import { after, NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import {
  deleteHouseholdMeal,
  getHouseholdMeal,
  HouseholdMealError,
  updateHouseholdMeal,
} from '@/lib/household-meals'
import { captureApiError } from '@/lib/errors'
import { discardMealImage } from '@/lib/meal-images/storage'
import { claimSavedMealImage, drawSavedMealImage } from '@/lib/meal-images/start'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { duplicateComponentIds, mealComponentsSchema } from '@/lib/meal-planning/components-schema'

const ROUTE = '/api/households/me/meals/[id]'

const updateMealSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  preparationNotes: z.string().max(5000).nullable().optional(),
  sourceUrl: z
    .string()
    .url()
    .max(2000)
    .refine((url) => /^https?:\/\//i.test(url), 'Only http/https URLs are allowed')
    .nullable()
    .optional(),
  timeMinutes: z.number().int().positive().max(480).nullable().optional(),
  kidFriendly: z.boolean().optional(),
  suitableFor: z
    .array(z.enum(['breakfast', 'lunch', 'dinner']))
    .min(1)
    .optional(),
  servings: z.number().int().positive().max(50).optional(),
  components: mealComponentsSchema.optional(),
})

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const meal = await getHouseholdMeal(
      membership.household.id,
      id,
      resolveHouseholdLocale(membership.household),
    )

    return NextResponse.json(meal)
  } catch (error) {
    if (error instanceof HouseholdMealError && error.reason === 'mealNotFound') {
      return NextResponse.json({ error: 'Meal not found' }, { status: 404 })
    }

    captureApiError(error, { route: ROUTE, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to fetch meal' }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

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

    const parsed = updateMealSchema.safeParse(body)

    if (!parsed.success) {
      const duplicateIds = duplicateComponentIds(parsed.error)
      if (duplicateIds) {
        return NextResponse.json(
          { error: 'Duplicate ingredients in components', duplicateIds },
          { status: 400 },
        )
      }

      const errors = parsed.error.flatten().fieldErrors
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
    }

    const membership = await getHouseholdMembership(session.user.id)

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    const householdId = membership.household.id
    const { meal, discardedImageUrl, imageInvalidated } = await updateHouseholdMeal(
      householdId,
      id,
      parsed.data,
    )

    // After commit: a rolled-back edit must not have lost its image.
    await discardMealImage(discardedImageUrl, ROUTE)

    // An edit that cleared the image starts the new one at once, as a new
    // recipe does (HON-1364): claimed here, drawn after the response.
    if (imageInvalidated) {
      const imageClaim = await claimSavedMealImage(householdId, id, ROUTE)
      if (imageClaim) {
        const userId = session.user.id
        after(() => drawSavedMealImage(imageClaim, { householdId, userId, route: ROUTE }))
      }
    }

    return NextResponse.json(meal)
  } catch (error) {
    if (error instanceof HouseholdMealError) {
      if (error.reason === 'mealNotFound') {
        return NextResponse.json({ error: 'Recipe not found' }, { status: 404 })
      }
      return NextResponse.json(
        { error: 'Some ingredients not found', missingIds: error.missingIds },
        { status: 400 },
      )
    }

    captureApiError(error, { route: ROUTE, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to update recipe' }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

    // The image stays so the recipe can be restored; the purge cron deletes
    // it once the restore window has passed (HON-1336).
    await deleteHouseholdMeal(membership.household.id, id)

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof HouseholdMealError && error.reason === 'mealNotFound') {
      return NextResponse.json({ error: 'Meal not found' }, { status: 404 })
    }

    captureApiError(error, { route: ROUTE, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to delete meal' }, { status: 500 })
  }
}

/**
 * Platform execution ceiling for this route, in seconds. `after()` runs within
 * it, and the image redrawn after an edit needs up to 50 s of AI time
 * (`@/lib/meal-images/start`); 60 is the value every Vercel plan allows.
 */
export const maxDuration = 60
