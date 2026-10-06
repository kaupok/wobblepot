import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership, loadHouseholdServings } from '@/lib/household'
import { sumPortions } from '@/lib/meal-planning/servings'
import { invalidateFutureEntrySteps } from '@/lib/meal-planning/preparation-steps-cache'
import { captureApiError } from '@/lib/errors'

const updatePreferencesSchema = z.object({
  displayName: z
    .string()
    .max(50)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  portionMultiplier: z.number().min(0.5).max(3.0).optional(),
  targetCalories: z.number().int().min(500).max(5000).nullable().optional(),
  targetProtein: z.number().int().min(0).max(500).nullable().optional(),
  targetCarbs: z.number().int().min(0).max(500).nullable().optional(),
  targetFat: z.number().int().min(0).max(500).nullable().optional(),
  dietaryType: z.enum(['vegetarian', 'vegan', 'pescatarian']).nullable().optional(),
  allergens: z
    .array(
      z.enum(['gluten', 'dairy', 'eggs', 'nuts', 'peanuts', 'soy', 'fish', 'shellfish', 'sesame']),
    )
    .optional(),
  restrictions: z.array(z.string()).optional(),
  excludedIngredients: z.array(z.string()).optional(),
  excludedIngredientIds: z.array(z.string()).optional(),
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

    // Get or create member preferences
    let preferences = await prisma.memberPreferences.findUnique({
      where: { memberId: membership.id },
    })

    if (!preferences) {
      preferences = await prisma.memberPreferences.create({
        data: { memberId: membership.id },
      })
    }

    return NextResponse.json(preferences)
  } catch (error) {
    captureApiError(error, { route: '/api/members/me/preferences', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to fetch member preferences' }, { status: 500 })
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

    const { portionMultiplier } = parsed.data
    const preferences = await prisma.$transaction(async (tx) => {
      const stored =
        portionMultiplier === undefined
          ? null
          : await tx.memberPreferences.findUnique({
              where: { memberId: membership.id },
              select: { portionMultiplier: true },
            })
      // A missing preferences row is the column default, 1×.
      const portionChanged =
        portionMultiplier !== undefined && portionMultiplier !== (stored?.portionMultiplier ?? 1)

      const saved = await tx.memberPreferences.upsert({
        where: { memberId: membership.id },
        create: {
          memberId: membership.id,
          ...parsed.data,
        },
        update: parsed.data,
      })

      // A portion size is summed into the household's servings, which price
      // the cached prep tips on every entry without a `servingOverride`
      // (HON-1040). Clear them only when those servings moved: the sum is
      // rounded to 0.5, so 1.5 + 0.75 and 1.5 + 1 both price 2.5, and a
      // needless invalidation costs a paid regeneration per entry (HON-684).
      // `portionChanged` is the cheap guard that skips the re-read.
      if (
        portionChanged &&
        (await loadHouseholdServings(membership.householdId, tx)) !==
          sumPortions(membership.household.members)
      ) {
        await invalidateFutureEntrySteps(tx, membership.householdId, membership.household.timezone)
      }

      return saved
    })

    return NextResponse.json(preferences)
  } catch (error) {
    captureApiError(error, { route: '/api/members/me/preferences', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to update member preferences' }, { status: 500 })
  }
}
