import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { computeRequiredSlots, computeMealSlots } from '@/lib/meal-planning/slots'
import { getDatesBetween, toDateString } from '@/lib/meal-planning/dates'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import { getPantryIngredientNames } from '@/lib/meal-planning/pantry'
import { PLANNING_MODEL } from './models'
import { buildMealPlanPrompt } from './prompts'
import { logAiSample } from './sampling'
import { getFavoriteMealIds, getRecentMealIds, loadCandidatePools } from './plan-candidates'
import {
  hydratePlan,
  slotKey,
  validateAIResponseStructure,
  validateAndRepairPlan,
} from './plan-helpers'
import {
  MealPlanResponseSchema,
  InsufficientCandidatesError,
  NoEmptySlotsError,
  type GeneratePlanResult,
  type FillEmptySlotsOptions,
} from './types'

/**
 * Fill empty slots in an existing meal plan with AI-generated meals.
 * Does NOT delete existing entries - only adds new ones for empty slots.
 * Throws NoEmptySlotsError if there are no empty slots to fill.
 */
export async function fillEmptySlots(options: FillEmptySlotsOptions): Promise<GeneratePlanResult> {
  const {
    planId,
    householdId,
    startDate,
    endDate,
    dietaryType,
    allergensToAvoid,
    excludedIngredientIds,
    restrictions,
    locale,
    weekdayMealTypes,
    weekendMealTypes,
    onAiUsage,
  } = options

  // Fetch existing plan with entries
  const existingPlan = await prisma.mealPlan.findUnique({
    where: { id: planId },
    include: {
      entries: {
        include: {
          meal: {
            include: {
              components: {
                include: {
                  ingredient: true,
                },
              },
            },
          },
        },
      },
    },
  })

  if (!existingPlan || existingPlan.householdId !== householdId) {
    throw new Error('Plan not found')
  }

  // Calculate expected slots based on date range and meal type preferences
  const dates = getDatesBetween(startDate, endDate)

  // Find existing entry slots that actually have a meal assigned.
  // Entries with mealId=null are treated as empty (they show "No meal planned" in the UI).
  const filledSlotKeys = new Set(
    existingPlan.entries
      .filter((e) => e.mealId !== null)
      .map((e) => slotKey(toDateString(e.date), e.mealType)),
  )

  // Compute all expected slots
  const allSlots = computeMealSlots(dates, weekdayMealTypes, weekendMealTypes)

  // Find empty slots (expected minus filled)
  const emptySlots = allSlots.filter(
    (slot) => !filledSlotKeys.has(slotKey(slot.date, slot.mealType)),
  )

  // Track null-mealId entries only for slots we'll attempt to fill.
  // Don't delete orphaned entries for slots outside the expected set.
  const emptySlotKeys = new Set(emptySlots.map((s) => slotKey(toDateString(s.date), s.mealType)))
  const nullMealEntryIds = existingPlan.entries
    .filter(
      (e) => e.mealId === null && emptySlotKeys.has(slotKey(toDateString(e.date), e.mealType)),
    )
    .map((e) => e.id)

  if (emptySlots.length === 0) {
    throw new NoEmptySlotsError()
  }

  // Compute required protein slots for empty dinner slots only
  const emptyDinnerDates = emptySlots.filter((s) => s.mealType === 'dinner').map((s) => s.date)

  const requiredSlots = computeRequiredSlots({
    dietaryType,
    dates: emptyDinnerDates,
    weekdayMealTypes,
    weekendMealTypes,
  })

  // Get recent meal IDs to exclude, favorite meal IDs for prioritization, and pantry ingredients
  const [recentMealIds, favoriteMealIds, pantryIngredients] = await Promise.all([
    getRecentMealIds(householdId),
    getFavoriteMealIds(householdId),
    getPantryIngredientNames(householdId),
  ])

  const { candidatePools, candidatesByMealType, mealTypes } = await loadCandidatePools({
    slots: emptySlots,
    householdId,
    allergensToAvoid,
    excludedIngredientIds,
    recentMealIds,
    dietaryType,
    favoriteMealIds,
  })

  // Validate required pools have candidates
  for (const slot of requiredSlots) {
    const pool = slot.proteinType === 'fish' ? candidatePools.fish : candidatePools.legume
    if (pool.length === 0) {
      throw new InsufficientCandidatesError(slot.proteinType)
    }
  }

  // Check for unfillable slots (empty candidate pool for a meal type) and collect warnings
  const warnings: string[] = []
  const fillableSlots = emptySlots.filter((slot) => {
    const pool = candidatesByMealType.get(slot.mealType)
    if (!pool || pool.length === 0) {
      const dateStr = toDateString(slot.date)
      warnings.push(`No ${slot.mealType} candidates available for ${dateStr}`)
      return false
    }
    return true
  })

  // If no fillable slots remain, throw with warnings context
  if (fillableSlots.length === 0) {
    throw new NoEmptySlotsError()
  }

  // Compute remaining slots (not required protein slots)
  const requiredSlotKeys = new Set(requiredSlots.map((s) => slotKey(s.date, s.mealType)))
  const remainingSlots = fillableSlots.filter(
    (s) => !requiredSlotKeys.has(slotKey(s.date, s.mealType)),
  )

  // Build prompt and call AI for fillable slots only
  const prompt = buildMealPlanPrompt({
    startDate,
    endDate,
    totalEntries: fillableSlots.length,
    requiredSlots,
    remainingSlots,
    candidatePools,
    restrictions,
    candidatesByMealType,
    pantryIngredients,
    locale,
  })

  const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })

  const result = await generateObject({
    model: anthropic(PLANNING_MODEL),
    schema: MealPlanResponseSchema,
    prompt,
  })

  onAiUsage?.({
    model: PLANNING_MODEL,
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
  })

  const { object } = result

  await logAiSample({
    callSite: 'fill-empty-slots',
    locale,
    input: {
      mealTypes,
      totalEntries: fillableSlots.length,
      restrictionsCount: restrictions.length,
      hasPantry: pantryIngredients.length > 0,
      candidatePoolSizes: {
        fish: candidatePools.fish.length,
        legume: candidatePools.legume.length,
        any: candidatePools.any.length,
      },
    },
    output: { entries: object.entries },
  })

  // Hydrate with meal details
  const hydratedPlan = await hydratePlan(object.entries)

  // Validate AI response structure
  validateAIResponseStructure(hydratedPlan, fillableSlots)

  // Validate constraints and repair if needed
  const validatedPlan = validateAndRepairPlan(hydratedPlan, requiredSlots, candidatePools)

  // Delete orphaned entries (mealId=null) and create new entries in a transaction
  await prisma.$transaction(async (tx) => {
    // Delete orphaned null-mealId entries that overlap with fillable slots
    if (nullMealEntryIds.length > 0) {
      await tx.mealPlanEntry.deleteMany({
        where: { id: { in: nullMealEntryIds } },
      })
    }

    // Create new entries
    await tx.mealPlanEntry.createMany({
      data: validatedPlan.map((entry) => ({
        planId,
        date: entry.date,
        mealType: entry.mealType,
        mealId: entry.mealId,
        status: 'planned',
      })),
    })
  })

  // Fetch entries for this week with meal details
  const updatedPlan = await prisma.mealPlan.findUnique({
    where: { id: planId },
    include: {
      entries: {
        where: {
          date: { gte: startDate, lt: endDate },
        },
        include: {
          meal: {
            include: {
              components: {
                include: {
                  ingredient: true,
                },
              },
            },
          },
        },
        orderBy: [{ date: 'asc' }, { mealType: 'asc' }],
      },
    },
  })

  if (!updatedPlan) {
    throw new Error('Plan not found after update')
  }

  return {
    id: updatedPlan.id,
    startDate: toDateString(startDate),
    endDate: toDateString(endDate),
    entries: updatedPlan.entries.map((entry) => ({
      id: entry.id,
      date: toDateString(entry.date),
      mealType: entry.mealType,
      status: entry.status,
      meal: entry.meal
        ? {
            id: entry.meal.id,
            name: entry.meal.name,
            kidFriendly: entry.meal.kidFriendly,
            primaryProteinType: entry.meal.primaryProteinType,
            nutrition: computeMealNutrition(entry.meal.components),
          }
        : null,
    })),
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}
