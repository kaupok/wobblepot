import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'

import type { Prisma } from '@/generated/prisma/client'
import type { MealType } from '@/generated/prisma/enums'
import { serverEnv } from '@/lib/env'
import { getDatesBetween, toDateString } from '@/lib/meal-planning/dates'
import { computeMealNutrition } from '@/lib/meal-planning/nutrition'
import { getPantryIngredientNames } from '@/lib/meal-planning/pantry'
import {
  computeMealSlots,
  computeRequiredSlots,
  getOverSlots,
  type MealSlot,
} from '@/lib/meal-planning/slots'
import { prisma } from '@/lib/prisma'

import { PLANNING_MODEL } from './models'
import { getFavoriteMealIds, loadCandidatePools } from './plan-candidates'
import {
  hydratePlan,
  slotKey,
  validateAIResponseStructure,
  validateAndRepairPlan,
} from './plan-helpers'
import { buildMealPlanRequest } from './prompts'
import { logAiSample } from './sampling'
import {
  type CreateEmptyPlanOptions,
  type GeneratePlanOptions,
  type GeneratePlanResult,
  InsufficientCandidatesError,
} from './types'
import { toAiUsageStats, withUsageOnFailure } from './usage'

const ENTRY_INCLUDE = {
  meal: { include: { components: { include: { ingredient: true } } } },
} satisfies Prisma.MealPlanEntryInclude

type EntryWithMeal = Prisma.MealPlanEntryGetPayload<{ include: typeof ENTRY_INCLUDE }>

/** `MealPlan` include that loads the entries in [startDate, endDate) with their meals. */
function entriesInRange(startDate: Date, endDate: Date) {
  return {
    entries: {
      // Mains only, one per slot; sides are read with their main (HON-1609).
      where: { date: { gte: startDate, lt: endDate }, mainEntryId: null },
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
 * The `completed` entries in [startDate, endDate). Regeneration keeps these entries, so their
 * slots must not be offered to the generator (HON-650), and their dinners must not be planned
 * again beside them (HON-1393).
 */
async function getKeptEntries(
  householdId: string,
  startDate: Date,
  endDate: Date,
): Promise<{ slotKeys: Set<string>; dinnerIds: string[] }> {
  const kept = await prisma.mealPlanEntry.findMany({
    where: {
      plan: { householdId },
      status: 'completed',
      date: { gte: startDate, lt: endDate },
      // A slot is kept by its main; a side's meal is not a kept dinner (HON-1609).
      mainEntryId: null,
    },
    select: { date: true, mealType: true, mealId: true },
  })
  return {
    slotKeys: new Set(kept.map((e) => slotKey(e.date, e.mealType))),
    dinnerIds: kept.flatMap((e) => (e.mealType === 'dinner' && e.mealId ? [e.mealId] : [])),
  }
}

/**
 * Clear a date range before regenerating it. `completed` entries are kept: each one is the
 * record of a meal the pantry was already charged for, and reverting a completion does not
 * restock, so deleting it would leave a deduction nothing explains (HON-650). `planned` and
 * `skipped` entries were never charged and are replaced.
 *
 * It deletes mains only, and the cascade takes their sides, so a slot goes as a
 * whole. A side of a kept main stays with it (HON-1609). The cascade never takes
 * a cooked side, because a completed side always has a completed main: Cooked
 * on the main completes the slot, and a revert of the main reverts its sides
 * (HON-1596, Q1).
 *
 * The entries in `keepSlots` stay whatever their status: a slot that is over is left
 * untouched (HON-1523).
 */
async function deleteReplaceableEntries(
  tx: Prisma.TransactionClient,
  planId: string,
  startDate: Date,
  endDate: Date,
  keepSlots: MealSlot[] = [],
) {
  await tx.mealPlanEntry.deleteMany({
    where: {
      planId,
      date: { gte: startDate, lt: endDate },
      status: { not: 'completed' },
      mainEntryId: null,
      ...(keepSlots.length > 0 && {
        NOT: { OR: keepSlots.map(({ date, mealType }) => ({ date, mealType })) },
      }),
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
    aiBudgetMs,
    timezone,
    now = new Date(),
  } = options

  // Get dates for entries from the flexible date range (endDate is exclusive)
  const dates = getDatesBetween(startDate, endDate)

  // Completed entries survive regeneration, so their slots are not asked for. Leaving one in
  // would also make createMany collide with the kept row on the one-main-per-slot unique index.
  const kept = await getKeptEntries(householdId, startDate, endDate)
  // A slot on today that is over is left untouched, as a completed one is (HON-1523).
  const overSlots = getOverSlots(timezone, now)
  const overKeys = new Set(overSlots.map((s) => slotKey(s.date, s.mealType)))
  const isReplaceable = (s: { date: Date; mealType: MealType }) =>
    !kept.slotKeys.has(slotKey(s.date, s.mealType)) && !overKeys.has(slotKey(s.date, s.mealType))

  // Expand dates into meal slots based on meal type preferences
  const configuredSlots = computeMealSlots(dates, weekdayMealTypes, weekendMealTypes)
  const allSlots = configuredSlots.filter(isReplaceable)

  // Every slot in the range was already cooked or is over: nothing to generate, so skip the
  // AI call. Clearing the range still applies, which is exactly what createEmptyPlan does.
  if (configuredSlots.length > 0 && allSlots.length === 0) {
    return createEmptyPlan({ householdId, startDate, endDate, keepSlots: overSlots })
  }

  // Compute required protein slots over the replaceable dinner dates only, as fill-plan does.
  // Placing them over every date and filtering afterwards would drop, not move, a requirement
  // that landed on a kept day.
  const requiredSlots = computeRequiredSlots({
    dietaryType,
    dates: allSlots.filter((s) => s.mealType === 'dinner').map((s) => s.date),
    weekdayMealTypes,
    weekendMealTypes,
  })

  // Favorite meal IDs for prioritization, and pantry ingredients
  const [favoriteMealIds, pantryIngredients] = await Promise.all([
    getFavoriteMealIds(householdId),
    getPantryIngredientNames(householdId),
  ])

  const { candidatePools, candidatesByMealType, mealTypes } = await loadCandidatePools({
    slots: allSlots,
    householdId,
    allergensToAvoid,
    excludedIngredientIds,
    dietaryType,
    favoriteMealIds,
    keptDinnerIds: kept.dinnerIds,
  })

  // Validate required pools have candidates (for dinner balance constraints)
  for (const slot of requiredSlots) {
    const pool = slot.proteinType === 'fish' ? candidatePools.fish : candidatePools.legume
    if (pool.length === 0) {
      throw new InsufficientCandidatesError(slot.proteinType)
    }
  }

  const request = buildMealPlanRequest({
    startDate,
    endDate,
    slots: allSlots,
    requiredSlots,
    candidatePools,
    candidatesByMealType,
    restrictions,
    pantryIngredients,
    locale,
  })

  const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })

  // Started here, not when the route built its options: every query above —
  // the slot/kept-entry reads, the parallel history/favourite/pantry fetch and
  // `loadCandidatePools` — runs first, and a signal created earlier would
  // spend the AI budget on them. See `aiBudgetMs` in `./types`.
  const abortSignal = aiBudgetMs === undefined ? undefined : AbortSignal.timeout(aiBudgetMs)

  const startedAt = Date.now()

  const result = await withUsageOnFailure(PLANNING_MODEL, onAiUsage, () =>
    generateObject({
      ...request,
      model: anthropic(PLANNING_MODEL),
      // Wall-clock budget owned by `/api/meal-plans/generate` — shared by this
      // attempt and every retry, not a per-attempt timeout. Undefined only in
      // tests and other direct callers, which is the pre-HON-694 behaviour.
      abortSignal,
    }),
  )

  onAiUsage?.(toAiUsageStats(PLANNING_MODEL, result.usage, Date.now() - startedAt))

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

    await deleteReplaceableEntries(tx, plan.id, startDate, endDate, overSlots)

    // Create new entries. A slot completed after getKeptEntries ran would collide here and
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
 * Completed entries in the range are kept and returned, and so are the entries in `keepSlots`;
 * everything else is deleted.
 */
export async function createEmptyPlan(
  options: CreateEmptyPlanOptions,
): Promise<GeneratePlanResult> {
  const { householdId, startDate, endDate, keepSlots } = options

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

    await deleteReplaceableEntries(tx, plan.id, startDate, endDate, keepSlots)

    return tx.mealPlan.findUniqueOrThrow({
      where: { id: plan.id },
      include: entriesInRange(startDate, endDate),
    })
  })

  return formatPlanResult(mealPlan, startDate, endDate)
}
