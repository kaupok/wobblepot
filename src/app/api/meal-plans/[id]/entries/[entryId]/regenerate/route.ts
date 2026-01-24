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
 * Generate a reason string for why this meal is suggested.
 */
function generateReason(
  meal: {
    kidFriendly: boolean
    primaryProteinType: ProteinType
    topIngredients: { name: string }[]
  },
  currentMealTime: number | null,
  mealTime: number | null,
  index: number,
): string {
  // First suggestion: highlight time similarity if applicable
  if (index === 0 && currentMealTime && mealTime) {
    const timeDiff = Math.abs(mealTime - currentMealTime)
    if (timeDiff <= 10) {
      return 'Similar prep time'
    }
  }

  // Second suggestion: highlight kid-friendly if applicable
  if (index === 1 && meal.kidFriendly) {
    return 'Kid-friendly option'
  }

  // Third suggestion: highlight different style
  if (index === 2) {
    const mainIngredient = meal.topIngredients[0]?.name
    if (mainIngredient) {
      return `Features ${mainIngredient.toLowerCase()}`
    }
    return 'Different style'
  }

  // Default reasons based on attributes
  if (meal.kidFriendly) {
    return 'Kid-friendly option'
  }

  return 'Matches your preferences'
}

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
    // Fetch entry with plan and meal details
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
          },
        },
      },
    })

    if (!entry) {
      return NextResponse.json({ error: 'Entry not found or access denied' }, { status: 404 })
    }

    // Reject regeneration for past week plans (read-only)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (entry.plan.endDate < today) {
      return NextResponse.json({ error: 'Cannot regenerate past week plans' }, { status: 403 })
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

    // Get current meal time for comparison
    const currentMealTime = entry.meal?.timeMinutes ?? null

    // Select up to 3 diverse alternatives
    // Simple diversity: shuffle and pick first 3, prioritizing kid-friendly variety
    const shuffled = [...filteredCandidates].sort(() => Math.random() - 0.5)

    // Try to get a mix: one kid-friendly, one not (if available), then fill
    const kidFriendly = shuffled.filter((c) => c.kidFriendly)
    const notKidFriendly = shuffled.filter((c) => !c.kidFriendly)

    const selected: typeof shuffled = []
    if (kidFriendly.length > 0) selected.push(kidFriendly[0]!)
    if (notKidFriendly.length > 0 && selected.length < 3) selected.push(notKidFriendly[0]!)

    // Fill remaining slots
    for (const candidate of shuffled) {
      if (selected.length >= 3) break
      if (!selected.includes(candidate)) {
        selected.push(candidate)
      }
    }

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

    // Build response
    const alternatives: AlternativeMeal[] = selected.map((candidate, index) => {
      const mealDetail = mealDetailsMap.get(candidate.id)
      const components = mealDetail?.components ?? []

      return {
        id: candidate.id,
        name: candidate.name,
        timeMinutes: mealDetail?.timeMinutes ?? null,
        kidFriendly: candidate.kidFriendly,
        primaryProteinType: candidate.primaryProteinType,
        reason: generateReason(candidate, currentMealTime, mealDetail?.timeMinutes ?? null, index),
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
    console.error('Failed to generate alternatives:', error)
    return NextResponse.json({ error: 'Failed to generate alternatives' }, { status: 500 })
  }
}
