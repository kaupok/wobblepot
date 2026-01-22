import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { getCandidates, NO_REPEAT_DAYS, type CandidateMeal } from '@/lib/meal-planning/candidates'
import {
  computeRequiredSlots,
  computeMealSlots,
  type MealSlot,
  type SlotRequirement,
} from '@/lib/meal-planning/slots'
import {
  getWeekDates,
  getRemainingWeekDates,
  toDateString,
  parseLocalDate,
} from '@/lib/meal-planning/dates'
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
import type { MealType } from '@/generated/prisma/enums'

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
 * Get favorite meal IDs for a household.
 */
async function getFavoriteMealIds(householdId: string): Promise<string[]> {
  const favorites = await prisma.favoriteMeal.findMany({
    where: { householdId },
    select: { mealId: true },
  })

  return favorites.map((f) => f.mealId)
}

/**
 * Hydrate AI response with meal details from the database.
 */
async function hydratePlan(
  entries: Array<{ date: string; mealType: string; mealId: string }>,
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
      mealType: e.mealType as MealType,
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
 * Create a unique key for a slot (date + mealType).
 */
function slotKey(date: Date | string, mealType: MealType | string): string {
  const dateStr = typeof date === 'string' ? date : toDateString(date)
  return `${dateStr}:${mealType}`
}

/**
 * Validate AI response structure before constraint validation.
 * Throws MealPlanValidationError if structural validation fails.
 */
function validateAIResponseStructure(
  hydratedPlan: HydratedPlanEntry[],
  expectedSlots: MealSlot[],
): void {
  const expectedCount = expectedSlots.length

  // Check entry count (supports variable-length weeks and multiple meal types)
  if (hydratedPlan.length !== expectedCount) {
    throw new MealPlanValidationError(
      `Expected ${expectedCount} entries, got ${hydratedPlan.length}`,
    )
  }

  // Check for duplicate slots (date + mealType)
  const entryKeys = hydratedPlan.map((e) => slotKey(e.date, e.mealType))
  const uniqueKeys = new Set(entryKeys)
  if (uniqueKeys.size !== expectedCount) {
    throw new MealPlanValidationError(`Duplicate slots in response: ${entryKeys.join(', ')}`)
  }

  // Check slots match expected slots
  const expectedKeys = new Set(expectedSlots.map((s) => slotKey(s.date, s.mealType)))
  for (const key of entryKeys) {
    if (!expectedKeys.has(key)) {
      throw new MealPlanValidationError(
        `Unexpected slot ${key}, expected slots: ${[...expectedKeys].join(', ')}`,
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
 *
 * For partial weeks (mid-week signup), pass effectiveStartDate to generate
 * entries only from that date through Sunday.
 */
export async function generateMealPlan(options: GeneratePlanOptions): Promise<GeneratePlanResult> {
  const {
    householdId,
    startDate,
    effectiveStartDate,
    dietaryType,
    allergensToAvoid,
    excludedIngredientIds,
    restrictions,
    weekdayMealTypes = ['dinner'] as MealType[],
    weekendMealTypes = ['dinner'] as MealType[],
  } = options

  // Get dates for entries: full week or partial week from effectiveStartDate
  const dates = effectiveStartDate
    ? getRemainingWeekDates(effectiveStartDate)
    : getWeekDates(startDate)

  // endDate is exclusive (day after the last entry) - e.g., Mon-Sun plan has endDate of next Monday
  const endDate = new Date(startDate)
  endDate.setDate(startDate.getDate() + 7)

  // Expand dates into meal slots based on meal type preferences
  const allSlots = computeMealSlots(dates, weekdayMealTypes, weekendMealTypes)

  // Compute required protein slots based on dietary type (dinner only)
  const requiredSlots = computeRequiredSlots({
    dietaryType,
    dates,
    weekdayMealTypes,
    weekendMealTypes,
  })

  // Get recent meal IDs to exclude and favorite meal IDs for prioritization
  const [recentMealIds, favoriteMealIds] = await Promise.all([
    getRecentMealIds(householdId),
    getFavoriteMealIds(householdId),
  ])

  // Collect unique meal types to query candidates for
  const uniqueMealTypes = [...new Set(allSlots.map((s) => s.mealType))]

  // Query candidate pools for each meal type in parallel
  // Include both system meals and household's custom meals
  const candidatesByMealType = new Map<MealType, CandidateMeal[]>()
  await Promise.all(
    uniqueMealTypes.map(async (mealType) => {
      const candidates = await getCandidates({
        mealType,
        allergensToAvoid,
        excludedIngredientIds,
        recentMealIds,
        dietaryType,
        householdId,
        favoriteMealIds,
      })
      candidatesByMealType.set(mealType, capPool(candidates))
    }),
  )

  // For dinner slots, also query protein-specific pools for balance constraints
  const dinnerCandidates = candidatesByMealType.get('dinner') ?? []
  const [fishCandidates, legumeCandidates] = await Promise.all([
    getCandidates({
      mealType: 'dinner',
      allergensToAvoid,
      excludedIngredientIds,
      recentMealIds,
      dietaryType,
      primaryProteinType: 'fish',
      householdId,
      favoriteMealIds,
    }),
    getCandidates({
      mealType: 'dinner',
      allergensToAvoid,
      excludedIngredientIds,
      recentMealIds,
      dietaryType,
      primaryProteinType: 'legume',
      householdId,
      favoriteMealIds,
    }),
  ])

  const candidatePools: CandidatePools = {
    fish: capPool(fishCandidates),
    legume: capPool(legumeCandidates),
    any: capPool(dinnerCandidates),
    byMealType: candidatesByMealType,
  }

  // Validate required pools have candidates (for dinner balance constraints)
  for (const slot of requiredSlots) {
    const pool = slot.proteinType === 'fish' ? candidatePools.fish : candidatePools.legume
    if (pool.length === 0) {
      throw new InsufficientCandidatesError(slot.proteinType)
    }
  }

  // Compute remaining slots (not required protein slots)
  const requiredSlotKeys = new Set(requiredSlots.map((s) => slotKey(s.date, s.mealType)))
  const remainingSlots = allSlots.filter((s) => !requiredSlotKeys.has(slotKey(s.date, s.mealType)))

  // Build prompt and call AI
  const prompt = buildMealPlanPrompt({
    startDate,
    endDate,
    totalEntries: allSlots.length,
    requiredSlots,
    remainingSlots,
    candidatePools,
    restrictions,
    candidatesByMealType,
  })

  const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })

  const { object } = await generateObject({
    model: anthropic('claude-sonnet-4-20250514'),
    schema: MealPlanResponseSchema,
    prompt,
  })

  // Hydrate with meal details
  const hydratedPlan = await hydratePlan(object.entries)

  // Validate AI response structure (entry count, slots)
  validateAIResponseStructure(hydratedPlan, allSlots)

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
            mealType: entry.mealType,
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
          orderBy: [{ date: 'asc' }, { mealType: 'asc' }],
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
  }
}
