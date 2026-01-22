import { toDateString } from '@/lib/meal-planning/dates'
import type { SlotRequirement } from '@/lib/meal-planning/slots'
import type { HydratedPlanEntry, ValidationResult, ValidationError } from './types'

/**
 * Create a unique key for a slot (date + mealType).
 */
function slotKey(entry: HydratedPlanEntry): string {
  return `${toDateString(entry.date)}:${entry.mealType}`
}

/**
 * Validate a hydrated meal plan against constraints.
 * Checks: required slot protein types, consecutive proteins (within same meal type), invalid meals, duplicates.
 */
export function validatePlan(
  hydratedPlan: HydratedPlanEntry[],
  requiredSlots: SlotRequirement[],
): ValidationResult {
  const errors: ValidationError[] = []

  // Build a map of slot key -> entry for quick lookup
  const entryBySlot = new Map(hydratedPlan.map((e) => [slotKey(e), e]))

  // Check 1: Required slots have correct protein type (dinner only)
  for (const slot of requiredSlots) {
    const key = `${toDateString(slot.date)}:${slot.mealType}`
    const entry = entryBySlot.get(key)

    if (entry?.meal) {
      const actualProtein = entry.meal.primaryProteinType
      if (actualProtein !== slot.proteinType) {
        errors.push({
          type: 'wrong_protein',
          date: toDateString(slot.date),
          mealType: slot.mealType,
          expected: slot.proteinType,
          actual: actualProtein,
          message: `${toDateString(slot.date)} ${slot.mealType} requires ${slot.proteinType}, got ${actualProtein}`,
        })
      }
    }
  }

  // Check 2: No consecutive days with same protein type (dinner only)
  // Per project spec: "Balance constraints via protein type slots (dinner only)"
  const dinnerEntries = hydratedPlan.filter((e) => e.mealType === 'dinner')
  const sortedDinnerEntries = [...dinnerEntries].sort((a, b) => a.date.getTime() - b.date.getTime())

  for (let i = 0; i < sortedDinnerEntries.length - 1; i++) {
    const current = sortedDinnerEntries[i]!
    const next = sortedDinnerEntries[i + 1]!

    // Skip if either meal is null (will be caught by invalid_meal check)
    if (!current.meal || !next.meal) continue

    // Check if days are consecutive
    const currentDay = current.date.getTime()
    const nextDay = next.date.getTime()
    const dayDiff = (nextDay - currentDay) / (1000 * 60 * 60 * 24)

    // Only check consecutive days, skip 'none' protein (vegan meals)
    if (
      dayDiff === 1 &&
      current.meal.primaryProteinType === next.meal.primaryProteinType &&
      current.meal.primaryProteinType !== 'none'
    ) {
      errors.push({
        type: 'consecutive_protein',
        date: toDateString(next.date),
        mealType: next.mealType,
        actual: next.meal.primaryProteinType,
        message: `Consecutive ${next.meal.primaryProteinType} for dinner on ${toDateString(current.date)} and ${toDateString(next.date)}`,
      })
    }
  }

  // Check 3: All meal IDs are valid (meal not null)
  for (const entry of hydratedPlan) {
    if (!entry.meal) {
      errors.push({
        type: 'invalid_meal',
        date: toDateString(entry.date),
        mealType: entry.mealType,
        message: `Invalid meal ID ${entry.mealId} on ${toDateString(entry.date)} ${entry.mealType}`,
      })
    }
  }

  // Check 4: No duplicate meals (dinner only)
  // Breakfast/lunch can repeat (e.g., toast daily), but dinner needs variety
  const seenDinnerMealIds = new Set<string>()
  const sortedDinnerForDuplicates = [...dinnerEntries].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  )

  for (const entry of sortedDinnerForDuplicates) {
    if (entry.meal && seenDinnerMealIds.has(entry.mealId)) {
      errors.push({
        type: 'duplicate_meal',
        date: toDateString(entry.date),
        mealType: entry.mealType,
        message: `Duplicate meal ${entry.meal.name} (${entry.mealId}) on ${toDateString(entry.date)} ${entry.mealType}`,
      })
    }
    if (entry.meal) {
      seenDinnerMealIds.add(entry.mealId)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
