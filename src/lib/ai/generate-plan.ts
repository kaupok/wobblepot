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
  type GeneratePlanOptions,
  type GeneratePlanResult,
  type CreateEmptyPlanOptions,
} from './types'
import type { Prisma } from '@/generated/prisma/client'
import type { MealType } from '@/generated/prisma/enums'

const ENTRY_INCLUDE = {
  meal: { include: { components: { include: { ingredient: true } } } },
} satisfies Prisma.MealPlanEntryInclude

type EntryWithMeal = Prisma.MealPlanEntryGetPayload<{ include: typeof ENTRY_INCLUDE }>

/** `MealPlan` include that loads the entries in [startDate, endDate) with their meals. */
function entriesInRange(startDate: Date, endDate: Date) {
  return {
    entries: {
      where: { date: { gte: startDate, lt: endDate } },
      include: ENTRY_INCLUDE,
      orderBy: [{ date: 'asc' }, { mealType: 'asc' }],
    },
  } satisfies Prisma.MealPlanInclude
}

function formatPlanResult(
  plan: { id: string; entries: EntryWithMeal[] },
  startDate: Date,
  endDate: Date,
): GeneratePlanResult {
  return {
    id: plan.id,
    startDate: toDateString(startDate),
    endDate: toDateString(endDate),
    entries: plan.entries.map((entry) => ({
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
 * Slot keys of the `completed` entries in [startDate, endDate). Regeneration keeps these
 * entries, so their slots must not be offered to the generator (HON-650).
 */
async function getKeptSlotKeys(
  householdId: string,
  startDate: Date,
  endDate: Date,
): Promise<Set<string>> {
  const kept = await prisma.mealPlanEntry.findMany({
    where: {
      plan: { householdId },
      status: 'completed',
      date: { gte: startDate, lt: endDate },
    },
    select: { date: true, mealType: true },
  })
  return new Set(kept.map((e) => slotKey(e.date, e.mealType)))
}

/**
 * Clear a date range before regenerating it. `completed` entries are kept: each one is the
 * record of a meal the pantry was already charged for, and reverting a completion does not
 * restock, so deleting it would leave a deduction nothing explains (HON-650). `planned` and
 * `skipped` entries were never charged and are replaced.
 */
async function deleteReplaceableEntries(
  tx: Prisma.TransactionClient,
  planId: string,
  startDate: Date,
  endDate: Date,
) {
  await tx.mealPlanEntry.deleteMany({
    where: {
      planId,
      date: { gte: startDate, lt: endDate },
      status: { not: 'completed' },
    },
  })
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
    locale,
    weekdayMealTypes = ['dinner'] as MealType[],
    weekendMealTypes = ['dinner'] as MealType[],
    onAiUsage,
  } = options

  // Get dates for entries from the flexible date range (endDate is exclusive)
  const dates = getDatesBetween(startDate, endDate)

  // Completed entries survive regeneration, so their slots are not asked for. Leaving one in
  // would also make createMany collide with the kept row on @@unique([planId, date, mealType]).
  const keptSlotKeys = await getKeptSlotKeys(householdId, startDate, endDate)
  const isReplaceable = (s: { date: Date; mealType: MealType }) =>
    !keptSlotKeys.has(slotKey(s.date, s.mealType))

  // Expand dates into meal slots based on meal type preferences
  const configuredSlots = computeMealSlots(dates, weekdayMealTypes, weekendMealTypes)
  const allSlots = configuredSlots.filter(isReplaceable)

  // Every slot in the range was already cooked: nothing to generate, so skip the AI call.
  // Clearing the range still applies, which is exactly what createEmptyPlan does.
  if (configuredSlots.length > 0 && allSlots.length === 0) {
    return createEmptyPlan({ householdId, startDate, endDate })
  }

  // Compute required protein slots based on dietary type (dinner only)
  const requiredSlots = computeRequiredSlots({
    dietaryType,
    dates,
    weekdayMealTypes,
    weekendMealTypes,
  }).filter(isReplaceable)

  // Get recent meal IDs to exclude, favorite meal IDs for prioritization, and pantry ingredients
  const [recentMealIds, favoriteMealIds, pantryIngredients] = await Promise.all([
    getRecentMealIds(householdId),
    getFavoriteMealIds(householdId),
    getPantryIngredientNames(householdId),
  ])

  const { candidatePools, candidatesByMealType, mealTypes } = await loadCandidatePools({
    slots: allSlots,
    householdId,
    allergensToAvoid,
    excludedIngredientIds,
    recentMealIds,
    dietaryType,
    favoriteMealIds,
  })

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
    callSite: 'generate-plan',
    locale,
    input: {
      mealTypes,
      totalEntries: allSlots.length,
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

    await deleteReplaceableEntries(tx, plan.id, startDate, endDate)

    // Create new entries. A slot completed after getKeptSlotKeys ran would collide here and
    // roll the transaction back — a failed regeneration, not a lost completion.
    await tx.mealPlanEntry.createMany({
      data: validatedPlan.map((entry) => ({
        planId: plan.id,
        date: entry.date,
        mealType: entry.mealType,
        mealId: entry.mealId,
        status: 'planned',
      })),
    })

    // Return plan with entries (new ones plus any kept completed entries)
    return tx.mealPlan.findUniqueOrThrow({
      where: { id: plan.id },
      include: entriesInRange(startDate, endDate),
    })
  })

  // Format response — compute startDate/endDate from the generation range
  return formatPlanResult(mealPlan, startDate, endDate)
}

/**
 * Clear a date range of its plannable entries.
 * Completed entries in the range are kept and returned; everything else is deleted.
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

    await deleteReplaceableEntries(tx, plan.id, startDate, endDate)

    return tx.mealPlan.findUniqueOrThrow({
      where: { id: plan.id },
      include: entriesInRange(startDate, endDate),
    })
  })

  return formatPlanResult(mealPlan, startDate, endDate)
}
