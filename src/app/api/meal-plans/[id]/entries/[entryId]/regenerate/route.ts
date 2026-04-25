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
import { AiCostCapExceededError, assertUnderCap, respondCapExceeded } from '@/lib/ai/usage'
import { withRequestId } from '@/lib/request-id'
import { captureApiError } from '@/lib/errors'
import type { Allergen, MealType, ProteinType } from '@/generated/prisma/enums'
import type { AlternativeMeal } from '@/components/meal-plan/types'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'

interface ScoredCandidate {
  candidate: {
    id: string
    name: string
    kidFriendly: boolean
    primaryProteinType: ProteinType
    topIngredients: { name: string }[]
    isFavorite: boolean
    isCustom: boolean
  }
  score: number
  timeMinutes: number | null
  reasons: string[]
}

/**
 * Score a candidate for similarity and personalization.
 * Returns score and reasons for the suggestion.
 */
function scoreCandidate(
  candidate: {
    kidFriendly: boolean
    primaryProteinType: ProteinType
    topIngredients: { name: string }[]
    isFavorite: boolean
    isCustom: boolean
  },
  timeMinutes: number | null,
  currentProteinType: ProteinType | null,
  currentTimeMinutes: number | null,
  pantryIngredientNames?: Set<string>,
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  // Similarity scoring (for swaps, similarity to current meal matters)
  if (currentProteinType && candidate.primaryProteinType === currentProteinType) {
    score += 3
    reasons.push('Same protein type')
  }
  if (currentTimeMinutes && timeMinutes) {
    const timeDiff = Math.abs(timeMinutes - currentTimeMinutes)
    if (timeDiff <= 15) {
      score += 2
      reasons.push('Similar prep time')
    }
  }

  // Personalization scoring
  if (candidate.isFavorite) {
    score += 2
    reasons.push('One of your favorites')
  }
  if (candidate.isCustom) {
    score += 1
    reasons.push('From your recipes')
  }

  // Kid-friendly is a minor boost
  if (candidate.kidFriendly) {
    score += 0.5
  }

  // Pantry-aware scoring: boost meals using ingredients already in stock
  if (pantryIngredientNames && pantryIngredientNames.size > 0) {
    const matchCount = candidate.topIngredients.filter((i) =>
      pantryIngredientNames.has(i.name),
    ).length
    if (matchCount > 0) {
      score += matchCount * 0.5
      reasons.push('Uses ingredients you have')
    }
  }

  return { score, reasons }
}

/**
 * Generate a reason string from scored reasons.
 */
function generateReason(
  reasons: string[],
  candidate: { kidFriendly: boolean; primaryProteinType: ProteinType },
): string {
  // Use the most relevant reason from scoring
  if (reasons.length > 0) {
    return reasons[0]!
  }

  // Fallback reasons
  if (candidate.kidFriendly) {
    return 'Kid-friendly option'
  }

  const proteinLabel = candidate.primaryProteinType !== 'none' ? candidate.primaryProteinType : null
  if (proteinLabel) {
    return `${proteinLabel.charAt(0).toUpperCase() + proteinLabel.slice(1)}-based`
  }

  return 'Matches your preferences'
}

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

  try {
    await assertUnderCap(household.id)
  } catch (error) {
    if (error instanceof AiCostCapExceededError) {
      return respondCapExceeded(error)
    }
    throw error
  }

  try {
    // Fetch entry with plan and meal details (including protein type for similarity scoring)
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
        meal: {
          select: {
            id: true,
            timeMinutes: true,
            primaryProteinType: true,
          },
        },
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

    // Exclude current meal
    const currentMealId = entry.mealId
    const filteredCandidates = candidates.filter((c) => c.id !== currentMealId)

    // No alternatives available
    if (filteredCandidates.length === 0) {
      return NextResponse.json(
        { error: 'No alternative meals available matching your preferences' },
        { status: 404 },
      )
    }

    // Get current meal attributes for similarity scoring
    const currentMealTime = entry.meal?.timeMinutes ?? null
    const currentProteinType = entry.meal?.primaryProteinType ?? null

    // Fetch timeMinutes for all candidates (needed for similarity scoring)
    const candidateMealDetails = await prisma.meal.findMany({
      where: { id: { in: filteredCandidates.map((c) => c.id) } },
      select: { id: true, timeMinutes: true },
    })
    const timeMap = new Map(candidateMealDetails.map((m) => [m.id, m.timeMinutes]))

    // Score candidates by similarity, personalization, and pantry overlap
    const scored: ScoredCandidate[] = filteredCandidates.map((candidate) => {
      const timeMinutes = timeMap.get(candidate.id) ?? null
      const { score, reasons } = scoreCandidate(
        candidate,
        timeMinutes,
        currentProteinType,
        currentMealTime,
        pantryIngredientNames,
      )
      // Add small random factor (0-0.5) for variety among equal-scored items
      return {
        candidate,
        score: score + Math.random() * 0.5,
        timeMinutes,
        reasons,
      }
    })

    // Sort by score descending and take top 3
    scored.sort((a, b) => b.score - a.score)
    const selected = scored.slice(0, 3)

    // Fetch full meal details for selected candidates
    const mealDetails = await prisma.meal.findMany({
      where: { id: { in: selected.map((s) => s.candidate.id) } },
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

    // Build response
    const alternatives: AlternativeMeal[] = selected.map((scoredItem) => {
      const { candidate, reasons } = scoredItem
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
        reason: generateReason(reasons, candidate),
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
      }
    })

    return NextResponse.json({ alternatives }, { status: 200 })
  } catch (error) {
    captureApiError(error, {
      route: '/api/meal-plans/[id]/entries/[entryId]/regenerate',
      userId: session.user.id,
      feature: 'meal_regenerate',
    })
    return NextResponse.json({ error: 'Failed to generate alternatives' }, { status: 500 })
  }
}

export const POST = withRequestId(handlePOST)
