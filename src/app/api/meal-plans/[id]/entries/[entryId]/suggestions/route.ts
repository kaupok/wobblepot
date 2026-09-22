import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import {
  getCandidates,
  NO_REPEAT_DAYS,
  type CandidateFilters,
} from '@/lib/meal-planning/candidates'
import { computeRequiredSlots } from '@/lib/meal-planning/slots'
import { getWeekDates, toDateString, getMondayOfWeek } from '@/lib/meal-planning/dates'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import { getPantryIngredientNames } from '@/lib/meal-planning/pantry'
import { SLOT_FIT_WEIGHTS, scoreCandidate, scoreJitter } from '@/lib/meal-planning/candidate-score'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'
import { AiCostCapExceededError, assertUnderCap, respondCapExceeded } from '@/lib/ai/usage'
import { withRequestId } from '@/lib/request-id'
import { captureApiError } from '@/lib/errors'
import { presentMealImage } from '@/lib/meal-images/present'
import type { Allergen, MealType } from '@/generated/prisma/enums'
import type { AlternativeMeal } from '@/components/meal-plan/types'

/**
 * POST /api/meal-plans/[id]/entries/[entryId]/suggestions
 *
 * Generate AI suggestions for an empty slot based on slot context (meal type + day).
 * Similar to /regenerate but designed for adding meals to empty slots.
 */
async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  // Auth check
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get household membership with preferences
  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const { household } = membership

  // Extract params
  const { id: planId, entryId } = await params

  const rateLimitResult = await checkRateLimit(household.id, 'meal-suggestions')
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        message: `Maximum ${rateLimitResult.limit} suggestion requests per hour`,
        resetAt: rateLimitResult.resetAt.toISOString(),
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds(rateLimitResult)) },
      },
    )
  }

  try {
    await assertUnderCap(household.id)
  } catch (error) {
    if (error instanceof AiCostCapExceededError) {
      return respondCapExceeded(error)
    }
    throw error
  }

  try {
    // Fetch entry with plan details
    const entry = await prisma.mealPlanEntry.findFirst({
      where: {
        id: entryId,
        planId: planId,
        plan: {
          householdId: household.id,
        },
      },
      include: {
        plan: true,
      },
    })

    if (!entry) {
      return NextResponse.json({ error: 'Entry not found or access denied' }, { status: 404 })
    }

    // Get preferences with defaults
    const preferences = household.preferences
    const dietaryType = preferences?.dietaryType ?? null
    const allergensToAvoid = (preferences?.allergensToAvoid ?? []) as Allergen[]
    const excludedIngredientIds = preferences?.excludedIngredientIds ?? []

    // Compute required slots to check if this entry needs a specific protein type
    const weekMonday = getMondayOfWeek(entry.date)
    const weekDates = getWeekDates(weekMonday)
    const weekdayMealTypes = (preferences?.weekdayMealTypes ?? ['dinner']) as MealType[]
    const weekendMealTypes = (preferences?.weekendMealTypes ?? ['dinner']) as MealType[]
    const requiredSlots = computeRequiredSlots({
      dietaryType,
      dates: weekDates,
      weekdayMealTypes,
      weekendMealTypes,
    })

    // Check if this entry's date and mealType is a required slot
    const entryDateString = toDateString(entry.date)
    const requiredSlot = requiredSlots.find(
      (slot) => toDateString(slot.date) === entryDateString && slot.mealType === entry.mealType,
    )

    // Get recent meal IDs (entries from plans within NO_REPEAT_DAYS window)
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - NO_REPEAT_DAYS)

    const recentEntries = await prisma.mealPlanEntry.findMany({
      where: {
        plan: { householdId: household.id },
        date: { gte: cutoffDate },
        mealId: { not: null },
      },
      select: { mealId: true },
    })

    const recentMealIds = [...new Set(recentEntries.map((e) => e.mealId!).filter(Boolean))]

    // Get favorite meal IDs and pantry ingredients for this household
    const [favorites, pantryIngredients] = await Promise.all([
      prisma.favoriteMeal.findMany({
        where: { householdId: household.id },
        select: { mealId: true },
      }),
      getPantryIngredientNames(household.id),
    ])
    const favoriteMealIds = favorites.map((f) => f.mealId)
    const pantryIngredientNames = new Set(pantryIngredients)

    // Build candidate filters
    const filters: CandidateFilters = {
      mealType: entry.mealType as MealType,
      allergensToAvoid,
      excludedIngredientIds,
      recentMealIds,
      primaryProteinType: requiredSlot?.proteinType,
      householdId: household.id,
      favoriteMealIds,
    }

    // Get candidates
    const candidates = await getCandidates(filters)

    // No suggestions available
    if (candidates.length === 0) {
      return NextResponse.json(
        { error: 'No meals available matching your preferences' },
        { status: 404 },
      )
    }

    // Score and sort candidates by personalization priority and pantry overlap.
    // The jitter is a seeded tie-break, so the same slot ranks reproducibly today while
    // different slots — and tomorrow — still vary. Seeded on the *current* date, not the
    // entry's: an entry's date never changes, so it would add nothing. See candidate-score.ts.
    const jitterDate = toDateString(new Date())
    const scored = candidates.map((c) => ({
      candidate: c,
      score:
        scoreCandidate(c, SLOT_FIT_WEIGHTS, { pantryIngredientNames }) +
        scoreJitter({ entryId, dateString: jitterDate, candidateId: c.id }),
    }))
    scored.sort((a, b) => b.score - a.score)

    // Take top 3
    const selected = scored.slice(0, 3).map((s) => s.candidate)

    // Fetch full meal details for selected candidates
    const mealDetails = await prisma.meal.findMany({
      where: { id: { in: selected.map((s) => s.id) } },
      include: {
        components: {
          include: {
            ingredient: {
              include: ingredientTranslationsInclude(household.locale),
            },
          },
        },
        ...mealTranslationsInclude(household.locale),
      },
    })

    const mealDetailsMap = new Map(mealDetails.map((m) => [m.id, m]))

    // Build response (using 'alternatives' key for compatibility with existing frontend)
    const alternatives: AlternativeMeal[] = selected.map((candidate) => {
      const mealDetail = mealDetailsMap.get(candidate.id)
      const translatedMeal = mealDetail ? translateMeal(mealDetail, household.locale) : null
      const components = mealDetail?.components ?? []

      return {
        id: candidate.id,
        name: translatedMeal?.name ?? candidate.name,
        description: translatedMeal?.description ?? null,
        timeMinutes: mealDetail?.timeMinutes ?? null,
        kidFriendly: candidate.kidFriendly,
        primaryProteinType: candidate.primaryProteinType,
        suitableFor: mealDetail?.suitableFor as MealType[] | undefined,
        components: components.map((comp) => {
          const translatedIngredient = translateIngredient(comp.ingredient, household.locale)
          return {
            ingredientId: comp.ingredientId,
            quantityPerServing: comp.quantityPerServing,
            isVague: comp.isVague,
            originalPhrase: comp.originalPhrase,
            ingredient: {
              id: translatedIngredient.id,
              name: translatedIngredient.name,
              category: translatedIngredient.category,
              defaultUnit: translatedIngredient.defaultUnit as 'g' | 'piece',
              gramsPerPiece: translatedIngredient.gramsPerPiece,
            },
          }
        }),
        nutrition: computeMealNutrition(components),
        ...(mealDetail
          ? presentMealImage(mealDetail)
          : { imageUrl: null, imageStatus: undefined, imageHue: null }),
      }
    })

    return NextResponse.json({ alternatives }, { status: 200 })
  } catch (error) {
    captureApiError(error, {
      route: '/api/meal-plans/[id]/entries/[entryId]/suggestions',
      userId: session.user.id,
      feature: 'meal_suggestions',
    })
    return NextResponse.json({ error: 'Failed to generate suggestions' }, { status: 500 })
  }
}

export const POST = withRequestId(handlePOST)
