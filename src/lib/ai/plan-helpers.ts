import { prisma } from '@/lib/prisma'
import { toDateString, parseLocalDate } from '@/lib/meal-planning/dates'
import type { MealSlot, SlotRequirement } from '@/lib/meal-planning/slots'
import { validatePlan } from './validate-plan'
import { repairPlan } from './repair-plan'
import { MealPlanValidationError, type CandidatePools, type HydratedPlanEntry } from './types'
import type { MealType } from '@/generated/prisma/enums'

/**
 * Hydrate AI response with meal details from the database.
 */
export async function hydratePlan(
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
export function slotKey(date: Date | string, mealType: MealType | string): string {
  const dateStr = typeof date === 'string' ? date : toDateString(date)
  return `${dateStr}:${mealType}`
}

/**
 * Validate AI response structure before constraint validation.
 * Throws MealPlanValidationError if structural validation fails.
 */
export function validateAIResponseStructure(
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
export function validateAndRepairPlan(
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
