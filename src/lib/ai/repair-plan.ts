import { toDateString } from '@/lib/meal-planning/dates'
import type { CandidateMeal } from '@/lib/meal-planning/candidates'
import type { MealType } from '@/generated/prisma/enums'
import type { CandidatePools, HydratedPlanEntry, ValidationError } from './types'

/**
 * Get the candidate pool for a specific meal type.
 * Falls back to candidatePools.any (dinner pool) if byMealType is not available.
 */
function getPoolForMealType(candidatePools: CandidatePools, mealType: MealType): CandidateMeal[] {
  return candidatePools.byMealType?.get(mealType) ?? candidatePools.any
}

/**
 * Attempt to repair a meal plan by swapping entries to fix validation errors.
 * Returns the repaired plan or null if repair is not possible.
 */
export function repairPlan(
  hydratedPlan: HydratedPlanEntry[],
  errors: ValidationError[],
  candidatePools: CandidatePools,
): HydratedPlanEntry[] | null {
  // Clone the plan to avoid mutation
  const plan = hydratedPlan.map((e) => ({ ...e }))

  // Track used meal IDs to avoid creating new duplicates
  const usedMealIds = new Set(plan.map((e) => e.mealId))

  // Build a map of slot key (date:mealType) -> index for quick lookup
  // This correctly handles multiple meal types per day
  const indexBySlot = new Map(plan.map((e, i) => [`${toDateString(e.date)}:${e.mealType}`, i]))

  // Group entries by meal type and sort by date for consecutive checks
  const sortedIndicesByMealType = new Map<string, number[]>()
  for (const [idx, entry] of plan.entries()) {
    const existing = sortedIndicesByMealType.get(entry.mealType) ?? []
    existing.push(idx)
    sortedIndicesByMealType.set(entry.mealType, existing)
  }
  // Sort each group by date
  for (const [, indices] of sortedIndicesByMealType) {
    indices.sort((a, b) => plan[a]!.date.getTime() - plan[b]!.date.getTime())
  }

  // Process errors
  for (const error of errors) {
    const slotKey = `${error.date}:${error.mealType}`
    const index = indexBySlot.get(slotKey)
    if (index === undefined) continue

    switch (error.type) {
      case 'wrong_protein': {
        if (!error.expected) continue
        const replacement = findReplacement(
          error.expected === 'fish' ? candidatePools.fish : candidatePools.legume,
          usedMealIds,
        )
        if (!replacement) return null
        swapEntry(plan, index, replacement, usedMealIds)
        break
      }

      case 'consecutive_protein': {
        // Get the sorted indices for this meal type
        const sortedIndices = sortedIndicesByMealType.get(error.mealType)
        if (!sortedIndices) continue

        // Find which index in sorted order this is
        const sortedIdx = sortedIndices.indexOf(index)
        if (sortedIdx === -1) continue

        // Get the previous entry (within the same meal type)
        const prevIndex = sortedIdx > 0 ? sortedIndices[sortedIdx - 1]! : null
        if (prevIndex === null) continue

        const currentEntry = plan[index]!
        const prevEntry = plan[prevIndex]!

        // Determine which entry to swap (prefer swapping current unless it's a required slot)
        // We'll swap current and try to find a different protein type
        const currentProtein = currentEntry.meal?.primaryProteinType
        if (!currentProtein) continue

        // Get the pool for this meal type (uses byMealType if available, falls back to any)
        const mealTypePool = getPoolForMealType(candidatePools, error.mealType)

        // Find a replacement with different protein type
        const replacement = findReplacementWithDifferentProtein(
          mealTypePool,
          usedMealIds,
          currentProtein,
        )

        if (replacement) {
          swapEntry(plan, index, replacement, usedMealIds)
        } else {
          // Try swapping the previous entry instead
          const prevProtein = prevEntry.meal?.primaryProteinType
          if (!prevProtein) continue

          const prevReplacement = findReplacementWithDifferentProtein(
            mealTypePool,
            usedMealIds,
            prevProtein,
          )
          if (!prevReplacement) return null
          swapEntry(plan, prevIndex, prevReplacement, usedMealIds)
        }
        break
      }

      case 'duplicate_meal': {
        const entry = plan[index]!
        const proteinType = entry.meal?.primaryProteinType
        if (!proteinType) continue

        // Get the pool for this meal type (uses byMealType if available)
        const mealTypePool = getPoolForMealType(candidatePools, error.mealType)

        // For dinner slots with fish/legume requirements, prefer protein-specific pools
        const isDinner = error.mealType === 'dinner'
        const proteinPool =
          isDinner && proteinType === 'fish'
            ? candidatePools.fish
            : isDinner && proteinType === 'legume'
              ? candidatePools.legume
              : mealTypePool

        // Find a replacement with the same protein type to maintain variety
        const replacement = findReplacementWithSameProtein(proteinPool, usedMealIds, proteinType)
        if (!replacement) {
          // Fall back to the meal type pool
          const anyReplacement = findReplacement(mealTypePool, usedMealIds)
          if (!anyReplacement) return null
          swapEntry(plan, index, anyReplacement, usedMealIds)
        } else {
          swapEntry(plan, index, replacement, usedMealIds)
        }
        break
      }

      case 'invalid_meal': {
        // Can't fix invalid meals without knowing what the original intent was
        // Return null to trigger AI retry
        return null
      }
    }
  }

  return plan
}

/**
 * Find a replacement candidate that isn't already used.
 */
function findReplacement(pool: CandidateMeal[], usedMealIds: Set<string>): CandidateMeal | null {
  return pool.find((c) => !usedMealIds.has(c.id)) ?? null
}

/**
 * Find a replacement with a different protein type than the given one.
 */
function findReplacementWithDifferentProtein(
  pool: CandidateMeal[],
  usedMealIds: Set<string>,
  excludeProtein: string,
): CandidateMeal | null {
  return pool.find((c) => !usedMealIds.has(c.id) && c.primaryProteinType !== excludeProtein) ?? null
}

/**
 * Find a replacement with the same protein type.
 */
function findReplacementWithSameProtein(
  pool: CandidateMeal[],
  usedMealIds: Set<string>,
  proteinType: string,
): CandidateMeal | null {
  return pool.find((c) => !usedMealIds.has(c.id) && c.primaryProteinType === proteinType) ?? null
}

/**
 * Swap an entry with a new candidate, updating the used meal IDs.
 */
function swapEntry(
  plan: HydratedPlanEntry[],
  index: number,
  candidate: CandidateMeal,
  usedMealIds: Set<string>,
): void {
  const entry = plan[index]!

  // Remove old meal ID from used set
  usedMealIds.delete(entry.mealId)

  // Update entry
  entry.mealId = candidate.id
  entry.meal = {
    id: candidate.id,
    name: candidate.name,
    primaryProteinType: candidate.primaryProteinType,
    kidFriendly: candidate.kidFriendly,
  }

  // Add new meal ID to used set
  usedMealIds.add(candidate.id)
}
