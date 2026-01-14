import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { getCandidates, NO_REPEAT_DAYS, type CandidateMeal } from '@/lib/meal-planning/candidates'
import { computeRequiredSlots } from '@/lib/meal-planning/slots'
import { getWeekDates, toDateString, parseLocalDate } from '@/lib/meal-planning/dates'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import { buildMealPlanPrompt } from './prompts'
import { validatePlan } from './validate-plan'
import { repairPlan } from './repair-plan'
import {
  MealPlanResponseSchema,
  MealPlanValidationError,
  InsufficientCandidatesError,
  type CandidatePools,
  type GeneratePlanOptions,
  type GeneratePlanResult,
  type HydratedPlanEntry,
} from './types'
import type { SlotRequirement } from '@/lib/meal-planning/slots'

const CANDIDATE_POOL_LIMIT = 50

/**
 * Cap a candidate pool to the limit, ensuring a mix of kid-friendly and adult meals.
 */
function capPool(candidates: CandidateMeal[], limit = CANDIDATE_POOL_LIMIT): CandidateMeal[] {
  if (candidates.length <= limit) return candidates

  const kidFriendly = candidates.filter((c) => c.kidFriendly)
  const adult = candidates.filter((c) => !c.kidFriendly)

  const result: CandidateMeal[] = []
  const halfLimit = Math.floor(limit / 2)

  // Add kid-friendly meals (up to half)
  result.push(...kidFriendly.slice(0, halfLimit))

  // Fill remaining with adult meals
  const remaining = limit - result.length
  result.push(...adult.slice(0, remaining))

  // If we still have space, add more kid-friendly
  if (result.length < limit && kidFriendly.length > halfLimit) {
    result.push(...kidFriendly.slice(halfLimit, halfLimit + (limit - result.length)))
  }

  return result
}

/**
 * Get recent meal IDs used in the last NO_REPEAT_DAYS for a household.
 */
async function getRecentMealIds(householdId: string): Promise<string[]> {
  // Normalize to local midnight to match database date storage
  const cutoffDate = new Date()
  cutoffDate.setHours(0, 0, 0, 0)
  cutoffDate.setDate(cutoffDate.getDate() - NO_REPEAT_DAYS)

  const recentEntries = await prisma.mealPlanEntry.findMany({
    where: {
      plan: { householdId },
      date: { gte: cutoffDate },
      mealId: { not: null },
    },
    select: { mealId: true },
  })

  return recentEntries.map((e) => e.mealId).filter((id): id is string => id !== null)
}

/**
 * Hydrate AI response with meal details from the database.
 */
async function hydratePlan(
  entries: Array<{ date: string; mealId: string }>,
): Promise<HydratedPlanEntry[]> {
  const mealIds = entries.map((e) => e.mealId)
  const meals = await prisma.meal.findMany({
    where: { id: { in: mealIds } },
    select: {
      id: true,
      name: true,
      primaryProteinType: true,
      kidFriendly: true,
    },
  })

  const mealMap = new Map(meals.map((m) => [m.id, m]))

  return entries.map((e) => {
    const meal = mealMap.get(e.mealId)
    return {
      date: parseLocalDate(e.date),
      mealId: e.mealId,
      meal: meal
        ? {
            id: meal.id,
            name: meal.name,
            primaryProteinType: meal.primaryProteinType,
            kidFriendly: meal.kidFriendly,
          }
        : null,
    }
  })
}

/**
 * Validate AI response structure before constraint validation.
 * Throws MealPlanValidationError if structural validation fails.
 */
function validateAIResponseStructure(
  hydratedPlan: HydratedPlanEntry[],
  expectedDates: Date[],
): void {
  // Check entry count
  if (hydratedPlan.length !== 7) {
    throw new MealPlanValidationError(`Expected 7 entries, got ${hydratedPlan.length}`)
  }

  // Check for duplicate dates
  const dateStrings = hydratedPlan.map((e) => toDateString(e.date))
  const uniqueDates = new Set(dateStrings)
  if (uniqueDates.size !== 7) {
    throw new MealPlanValidationError(`Duplicate dates in response: ${dateStrings.join(', ')}`)
  }

  // Check dates match expected week
  const expectedDateStrings = new Set(expectedDates.map(toDateString))
  for (const dateStr of dateStrings) {
    if (!expectedDateStrings.has(dateStr)) {
      throw new MealPlanValidationError(
        `Unexpected date ${dateStr}, expected dates: ${[...expectedDateStrings].join(', ')}`,
      )
    }
  }
}

/**
 * Validate and optionally repair a hydrated plan against constraints.
 * Returns the (possibly repaired) plan if valid, or throws MealPlanValidationError.
 */
function validateAndRepairPlan(
  hydratedPlan: HydratedPlanEntry[],
  requiredSlots: SlotRequirement[],
  candidatePools: CandidatePools,
): HydratedPlanEntry[] {
  // First validation pass
  const validation = validatePlan(hydratedPlan, requiredSlots)

  if (validation.valid) {
    return hydratedPlan
  }

  // Attempt repair
  const repaired = repairPlan(hydratedPlan, validation.errors, candidatePools)

  if (!repaired) {
    const errorSummary = validation.errors.map((e) => e.message).join('; ')
    throw new MealPlanValidationError(
      `Plan validation failed and repair not possible: ${errorSummary}`,
    )
  }

  // Re-validate repaired plan
  const revalidation = validatePlan(repaired, requiredSlots)

  if (!revalidation.valid) {
    const errorSummary = revalidation.errors.map((e) => e.message).join('; ')
    throw new MealPlanValidationError(`Plan still invalid after repair: ${errorSummary}`)
  }

  return repaired
}

/**
 * Generate a meal plan using AI.
 * Orchestrates: slot computation -> candidate query -> AI selection -> persist.
 */
export async function generateMealPlan(options: GeneratePlanOptions): Promise<GeneratePlanResult> {
  const {
    householdId,
    startDate,
    dietaryType,
    allergensToAvoid,
    excludedIngredientIds,
    restrictions,
  } = options

  // Get week dates
  const dates = getWeekDates(startDate)
  // endDate is exclusive (day after the last entry) - e.g., Mon-Sun plan has endDate of next Monday
  const endDate = new Date(startDate)
  endDate.setDate(startDate.getDate() + 7)

  // Compute required slots based on dietary type
  const requiredSlots = computeRequiredSlots(dietaryType, dates)

  // Get recent meal IDs to exclude
  const recentMealIds = await getRecentMealIds(householdId)

  // Base filters for all candidate queries
  const baseFilters = {
    mealType: 'dinner' as const,
    allergensToAvoid,
    excludedIngredientIds,
    recentMealIds,
  }

  // Query candidate pools in parallel
  const [fishCandidates, legumeCandidates, anyCandidates] = await Promise.all([
    getCandidates({ ...baseFilters, primaryProteinType: 'fish' }),
    getCandidates({ ...baseFilters, primaryProteinType: 'legume' }),
    getCandidates(baseFilters),
  ])

  const candidatePools: CandidatePools = {
    fish: capPool(fishCandidates),
    legume: capPool(legumeCandidates),
    any: capPool(anyCandidates),
  }

  // Validate required pools have candidates
  for (const slot of requiredSlots) {
    const pool = slot.proteinType === 'fish' ? candidatePools.fish : candidatePools.legume
    if (pool.length === 0) {
      throw new InsufficientCandidatesError(slot.proteinType)
    }
  }

  // Compute remaining dates (not required slots)
  const slotDateStrings = new Set(requiredSlots.map((s) => toDateString(s.date)))
  const remainingDates = dates.filter((d) => !slotDateStrings.has(toDateString(d)))

  // Build prompt and call AI
  const prompt = buildMealPlanPrompt({
    startDate,
    endDate,
    requiredSlots,
    remainingDates,
    candidatePools,
    restrictions,
  })

  const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })

  const { object } = await generateObject({
    model: anthropic('claude-sonnet-4-20250514'),
    schema: MealPlanResponseSchema,
    prompt,
  })

  // Hydrate with meal details
  const hydratedPlan = await hydratePlan(object.entries)

  // Validate AI response structure (entry count, dates)
  validateAIResponseStructure(hydratedPlan, dates)

  // Validate constraints and repair if needed (protein types, consecutive days, duplicates)
  const validatedPlan = validateAndRepairPlan(hydratedPlan, requiredSlots, candidatePools)

  // Delete existing plan and create new one in a transaction
  // This allows users to regenerate plans for the same week
  const mealPlan = await prisma.$transaction(async (tx) => {
    // Delete existing plan for this household+startDate if it exists
    await tx.mealPlan.deleteMany({
      where: {
        householdId,
        startDate,
      },
    })

    // Create new plan
    return tx.mealPlan.create({
      data: {
        householdId,
        startDate,
        endDate,
        entries: {
          create: validatedPlan.map((entry) => ({
            date: entry.date,
            mealType: 'dinner',
            mealId: entry.mealId,
            status: 'planned',
          })),
        },
      },
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
          orderBy: { date: 'asc' },
        },
      },
    })
  })

  // Format response
  return {
    id: mealPlan.id,
    startDate: toDateString(mealPlan.startDate),
    endDate: toDateString(mealPlan.endDate),
    entries: mealPlan.entries.map((entry) => ({
      id: entry.id,
      date: toDateString(entry.date),
      mealType: entry.mealType as 'dinner',
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
  }
}
