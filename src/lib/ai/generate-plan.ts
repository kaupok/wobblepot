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
import { getDatesBetween, toDateString, parseLocalDate } from '@/lib/meal-planning/dates'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import { getPantryIngredientNames } from '@/lib/meal-planning/pantry'
import { PLANNING_MODEL } from './models'
import { buildMealPlanPrompt } from './prompts'
import { validatePlan } from './validate-plan'
import { repairPlan } from './repair-plan'
import {
  MealPlanResponseSchema,
  MealPlanValidationError,
  InsufficientCandidatesError,
  NoEmptySlotsError,
  type CandidatePools,
  type GeneratePlanOptions,
  type GeneratePlanResult,
  type HydratedPlanEntry,
  type CreateEmptyPlanOptions,
  type FillEmptySlotsOptions,
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
 * Supports flexible date ranges via startDate + endDate (exclusive).
 */
export async function generateMealPlan(options: GeneratePlanOptions): Promise<GeneratePlanResult> {
  const {
    householdId,
    startDate,
    endDate,
    dietaryType,
    allergensToAvoid,
    excludedIngredientIds,
    restrictions,
    weekdayMealTypes = ['dinner'] as MealType[],
    weekendMealTypes = ['dinner'] as MealType[],
  } = options

  // Get dates for entries from the flexible date range (endDate is exclusive)
  const dates = getDatesBetween(startDate, endDate)

  // Expand dates into meal slots based on meal type preferences
  const allSlots = computeMealSlots(dates, weekdayMealTypes, weekendMealTypes)

  // Compute required protein slots based on dietary type (dinner only)
  const requiredSlots = computeRequiredSlots({
    dietaryType,
    dates,
    weekdayMealTypes,
    weekendMealTypes,
  })

  // Get recent meal IDs to exclude, favorite meal IDs for prioritization, and pantry ingredients
  const [recentMealIds, favoriteMealIds, pantryIngredients] = await Promise.all([
    getRecentMealIds(householdId),
    getFavoriteMealIds(householdId),
    getPantryIngredientNames(householdId),
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

  // Build protein-specific pools first
  const fishPool = capPool(fishCandidates)
  const legumePool = capPool(legumeCandidates)

  // Exclude protein-specific pool meals from "any" pool to reserve them for required slots.
  // This prevents the AI from using fish/legume meals for non-required slots, which would
  // deplete them and cause repair to fail when fixing required protein slot violations.
  const reservedMealIds = new Set([...fishPool.map((m) => m.id), ...legumePool.map((m) => m.id)])
  const anyPool = capPool(dinnerCandidates.filter((m) => !reservedMealIds.has(m.id)))

  const candidatePools: CandidatePools = {
    fish: fishPool,
    legume: legumePool,
    any: anyPool,
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
    pantryIngredients,
  })

  const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })

  const { object } = await generateObject({
    model: anthropic(PLANNING_MODEL),
    schema: MealPlanResponseSchema,
    prompt,
  })

  // Hydrate with meal details
  const hydratedPlan = await hydratePlan(object.entries)

  // Validate AI response structure (entry count, slots)
  validateAIResponseStructure(hydratedPlan, allSlots)

  // Validate constraints and repair if needed (protein types, consecutive days, duplicates)
  const validatedPlan = validateAndRepairPlan(hydratedPlan, requiredSlots, candidatePools)

  // Find or create single household plan, then delete existing entries for this date range
  // and create new ones. This allows users to regenerate plans for any week.
  const mealPlan = await prisma.$transaction(async (tx) => {
    // Find or create the single household plan
    let plan = await tx.mealPlan.findUnique({
      where: { householdId },
    })

    if (!plan) {
      plan = await tx.mealPlan.create({
        data: { householdId },
      })
    }

    // Delete existing entries for this date range
    await tx.mealPlanEntry.deleteMany({
      where: {
        planId: plan.id,
        date: { gte: startDate, lt: endDate },
      },
    })

    // Create new entries
    await tx.mealPlanEntry.createMany({
      data: validatedPlan.map((entry) => ({
        planId: plan.id,
        date: entry.date,
        mealType: entry.mealType,
        mealId: entry.mealId,
        status: 'planned',
      })),
    })

    // Return plan with entries
    return tx.mealPlan.findUniqueOrThrow({
      where: { id: plan.id },
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
  })

  // Format response — compute startDate/endDate from the generation range
  return {
    id: mealPlan.id,
    startDate: toDateString(startDate),
    endDate: toDateString(endDate),
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

/**
 * Create an empty meal plan (no entries for the given week).
 * Deletes any existing entries for the same date range.
 */
export async function createEmptyPlan(
  options: CreateEmptyPlanOptions,
): Promise<GeneratePlanResult> {
  const { householdId, startDate, endDate } = options

  // Find or create single household plan, clear entries for this date range
  const mealPlan = await prisma.$transaction(async (tx) => {
    let plan = await tx.mealPlan.findUnique({
      where: { householdId },
    })

    if (!plan) {
      plan = await tx.mealPlan.create({
        data: { householdId },
      })
    }

    // Delete existing entries for this date range
    await tx.mealPlanEntry.deleteMany({
      where: {
        planId: plan.id,
        date: { gte: startDate, lt: endDate },
      },
    })

    return plan
  })

  return {
    id: mealPlan.id,
    startDate: toDateString(startDate),
    endDate: toDateString(endDate),
    entries: [],
  }
}

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
    weekdayMealTypes,
    weekendMealTypes,
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

  // Collect unique meal types from empty slots
  const uniqueMealTypes = [...new Set(emptySlots.map((s) => s.mealType))]

  // Query candidate pools for each meal type
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

  const fishPool = capPool(fishCandidates)
  const legumePool = capPool(legumeCandidates)
  const reservedMealIds = new Set([...fishPool.map((m) => m.id), ...legumePool.map((m) => m.id)])
  const anyPool = capPool(dinnerCandidates.filter((m) => !reservedMealIds.has(m.id)))

  const candidatePools: CandidatePools = {
    fish: fishPool,
    legume: legumePool,
    any: anyPool,
    byMealType: candidatesByMealType,
  }

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
  })

  const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })

  const { object } = await generateObject({
    model: anthropic(PLANNING_MODEL),
    schema: MealPlanResponseSchema,
    prompt,
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
