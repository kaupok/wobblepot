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
          expected: slot.proteinType,
          actual: actualProtein,
          message: `${toDateString(slot.date)} ${slot.mealType} requires ${slot.proteinType}, got ${actualProtein}`,
        })
      }
    }
  }

  // Check 2: No consecutive days with same protein type (within same meal type)
  // Group entries by meal type, then check consecutiveness within each group
  const entriesByMealType = new Map<string, HydratedPlanEntry[]>()
  for (const entry of hydratedPlan) {
    const existing = entriesByMealType.get(entry.mealType) ?? []
    existing.push(entry)
    entriesByMealType.set(entry.mealType, existing)
  }

  for (const [mealType, entries] of entriesByMealType) {
    // Sort by date within each meal type
    const sorted = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime())

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i]!
      const next = sorted[i + 1]!

      // Skip if either meal is null (will be caught by invalid_meal check)
      if (!current.meal || !next.meal) continue

      // Check if days are consecutive
      const currentDay = current.date.getTime()
      const nextDay = next.date.getTime()
      const dayDiff = (nextDay - currentDay) / (1000 * 60 * 60 * 24)

      // Only check consecutive days (not same day with different meal types)
      if (dayDiff === 1 && current.meal.primaryProteinType === next.meal.primaryProteinType) {
        errors.push({
          type: 'consecutive_protein',
          date: toDateString(next.date),
          actual: next.meal.primaryProteinType,
          message: `Consecutive ${next.meal.primaryProteinType} for ${mealType} on ${toDateString(current.date)} and ${toDateString(next.date)}`,
        })
      }
    }
  }

  // Check 3: All meal IDs are valid (meal not null)
  for (const entry of hydratedPlan) {
    if (!entry.meal) {
      errors.push({
        type: 'invalid_meal',
        date: toDateString(entry.date),
        message: `Invalid meal ID ${entry.mealId} on ${toDateString(entry.date)} ${entry.mealType}`,
      })
    }
  }

  // Check 4: No duplicate meals (across all meal types)
  const seenMealIds = new Set<string>()
  const sortedEntries = [...hydratedPlan].sort((a, b) => {
    const dateDiff = a.date.getTime() - b.date.getTime()
    if (dateDiff !== 0) return dateDiff
    return a.mealType.localeCompare(b.mealType)
  })

  for (const entry of sortedEntries) {
    if (entry.meal && seenMealIds.has(entry.mealId)) {
      errors.push({
        type: 'duplicate_meal',
        date: toDateString(entry.date),
        message: `Duplicate meal ${entry.meal.name} (${entry.mealId}) on ${toDateString(entry.date)} ${entry.mealType}`,
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
