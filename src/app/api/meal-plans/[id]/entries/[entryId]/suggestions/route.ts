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
import { getWeekDates, toDateString } from '@/lib/meal-planning/dates'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import type { Allergen, DietaryType, MealType, ProteinType } from '@/generated/prisma/enums'
import type { AlternativeMeal } from '@/components/meal-plan/types'

/**
 * Score a candidate for personalization and variety.
 * Higher score = better match.
 */
function scoreCandidate(candidate: {
  isFavorite: boolean
  isCustom: boolean
  kidFriendly: boolean
}): number {
  let score = 0
  if (candidate.isFavorite) score += 3 // Explicit preference signal
  if (candidate.isCustom) score += 2 // Household created/imported
  // Kid-friendly gives slight boost for family households
  if (candidate.kidFriendly) score += 1
  return score
}

/**
 * Generate a reason string for why this meal is suggested.
 * Prioritizes personalization reasons (favorite, household meal).
 */
function generateReason(meal: {
  isFavorite: boolean
  isCustom: boolean
  kidFriendly: boolean
  primaryProteinType: ProteinType
  topIngredients: { name: string }[]
}): string {
  // Personalization reasons take priority
  if (meal.isFavorite) {
    return 'One of your favorites'
  }
  if (meal.isCustom) {
    return 'From your recipes'
  }
  if (meal.kidFriendly) {
    return 'Kid-friendly option'
  }

  // Fall back to protein type
  const proteinLabel = meal.primaryProteinType !== 'none' ? meal.primaryProteinType : null
  if (proteinLabel) {
    return `${proteinLabel.charAt(0).toUpperCase() + proteinLabel.slice(1)}-based`
  }

  return 'Matches your preferences'
}

/**
 * POST /api/meal-plans/[id]/entries/[entryId]/suggestions
 *
 * Generate AI suggestions for an empty slot based on slot context (meal type + day).
 * Similar to /regenerate but designed for adding meals to empty slots.
 */
export async function POST(
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

    // Reject suggestions for past week plans (read-only)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (entry.plan.endDate < today) {
      return NextResponse.json({ error: 'Cannot add meals to past week plans' }, { status: 403 })
    }

    // Get preferences with defaults
    const preferences = household.preferences
    const dietaryType = (preferences?.dietaryType ?? 'omnivore') as DietaryType
    const allergensToAvoid = (preferences?.allergensToAvoid ?? []) as Allergen[]
    const excludedIngredientIds = preferences?.excludedIngredientIds ?? []

    // Compute required slots to check if this entry needs a specific protein type
    const weekDates = getWeekDates(entry.plan.startDate)
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

    // Get favorite meal IDs for this household
    const favorites = await prisma.favoriteMeal.findMany({
      where: { householdId: household.id },
      select: { mealId: true },
    })
    const favoriteMealIds = favorites.map((f) => f.mealId)

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

    // Score and sort candidates by personalization priority
    // Add small random factor (0-0.5) for variety among equal-scored items
    const scored = candidates.map((c) => ({
      candidate: c,
      score: scoreCandidate(c) + Math.random() * 0.5,
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
            ingredient: true,
          },
        },
      },
    })

    const mealDetailsMap = new Map(mealDetails.map((m) => [m.id, m]))

    // Build response (using 'alternatives' key for compatibility with existing frontend)
    const alternatives: AlternativeMeal[] = selected.map((candidate) => {
      const mealDetail = mealDetailsMap.get(candidate.id)
      const components = mealDetail?.components ?? []

      return {
        id: candidate.id,
        name: candidate.name,
        description: mealDetail?.description ?? null,
        timeMinutes: mealDetail?.timeMinutes ?? null,
        kidFriendly: candidate.kidFriendly,
        primaryProteinType: candidate.primaryProteinType,
        suitableFor: mealDetail?.suitableFor as MealType[] | undefined,
        reason: generateReason(candidate),
        components: components.map((comp) => ({
          ingredientId: comp.ingredientId,
          quantityPerServing: comp.quantityPerServing,
          isVague: comp.isVague,
          originalPhrase: comp.originalPhrase,
          ingredient: {
            id: comp.ingredient.id,
            name: comp.ingredient.name,
            category: comp.ingredient.category,
            defaultUnit: comp.ingredient.defaultUnit as 'g' | 'piece',
            gramsPerPiece: comp.ingredient.gramsPerPiece,
          },
        })),
        nutrition: computeMealNutrition(components),
      }
    })

    return NextResponse.json({ alternatives }, { status: 200 })
  } catch (error) {
    console.error('Failed to generate suggestions:', error)
    return NextResponse.json({ error: 'Failed to generate suggestions' }, { status: 500 })
  }
}
