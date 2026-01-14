import { toDateString } from '@/lib/meal-planning/dates'
import type { SlotRequirement } from '@/lib/meal-planning/slots'
import type { HydratedPlanEntry, ValidationResult, ValidationError } from './types'

/**
 * Validate a hydrated meal plan against constraints.
 * Checks: required slot protein types, consecutive proteins, invalid meals, duplicates.
 */
export function validatePlan(
  hydratedPlan: HydratedPlanEntry[],
  requiredSlots: SlotRequirement[],
): ValidationResult {
  const errors: ValidationError[] = []

  // Build a map of date -> entry for quick lookup
  const entryByDate = new Map(hydratedPlan.map((e) => [toDateString(e.date), e]))

  // Check 1: Required slots have correct protein type
  for (const slot of requiredSlots) {
    const dateStr = toDateString(slot.date)
    const entry = entryByDate.get(dateStr)

    if (entry?.meal) {
      const actualProtein = entry.meal.primaryProteinType
      if (actualProtein !== slot.proteinType) {
        errors.push({
          type: 'wrong_protein',
          date: dateStr,
          expected: slot.proteinType,
          actual: actualProtein,
          message: `${dateStr} requires ${slot.proteinType}, got ${actualProtein}`,
        })
      }
    }
  }

  // Check 2: No consecutive days with same protein type
  // Sort entries by date first
  const sortedEntries = [...hydratedPlan].sort((a, b) => a.date.getTime() - b.date.getTime())

  for (let i = 0; i < sortedEntries.length - 1; i++) {
    const current = sortedEntries[i]!
    const next = sortedEntries[i + 1]!

    // Skip if either meal is null (will be caught by invalid_meal check)
    if (!current.meal || !next.meal) continue

    if (current.meal.primaryProteinType === next.meal.primaryProteinType) {
      errors.push({
        type: 'consecutive_protein',
        date: toDateString(next.date),
        actual: next.meal.primaryProteinType,
        message: `Consecutive ${next.meal.primaryProteinType} on ${toDateString(current.date)} and ${toDateString(next.date)}`,
      })
    }
  }

  // Check 3: All meal IDs are valid (meal not null)
  for (const entry of hydratedPlan) {
    if (!entry.meal) {
      errors.push({
        type: 'invalid_meal',
        date: toDateString(entry.date),
        message: `Invalid meal ID ${entry.mealId} on ${toDateString(entry.date)}`,
      })
    }
  }

  // Check 4: No duplicate meals
  const seenMealIds = new Set<string>()
  for (const entry of sortedEntries) {
    if (entry.meal && seenMealIds.has(entry.mealId)) {
      errors.push({
        type: 'duplicate_meal',
        date: toDateString(entry.date),
        message: `Duplicate meal ${entry.meal.name} (${entry.mealId}) on ${toDateString(entry.date)}`,
      })
    }
    if (entry.meal) {
      seenMealIds.add(entry.mealId)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
