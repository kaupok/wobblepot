import { toDateString } from '@/lib/meal-planning/dates'
import type { CandidateMeal } from '@/lib/meal-planning/candidates'
import type { CandidatePools, HydratedPlanEntry, ValidationError } from './types'

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

  // Build a map of date -> index for quick lookup
  const indexByDate = new Map(plan.map((e, i) => [toDateString(e.date), i]))

  // Sort entries by date for consecutive checks
  const sortedIndices = [...plan.keys()].sort(
    (a, b) => plan[a]!.date.getTime() - plan[b]!.date.getTime(),
  )

  // Process errors
  for (const error of errors) {
    const index = indexByDate.get(error.date)
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
        // Find which index in sorted order this is
        const sortedIdx = sortedIndices.indexOf(index)
        if (sortedIdx === -1) continue

        // Get the previous entry
        const prevIndex = sortedIdx > 0 ? sortedIndices[sortedIdx - 1]! : null
        if (prevIndex === null) continue

        const currentEntry = plan[index]!
        const prevEntry = plan[prevIndex]!

        // Determine which entry to swap (prefer swapping current unless it's a required slot)
        // We'll swap current and try to find a different protein type
        const currentProtein = currentEntry.meal?.primaryProteinType
        if (!currentProtein) continue

        // Find a replacement with different protein type
        const replacement = findReplacementWithDifferentProtein(
          candidatePools.any,
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
            candidatePools.any,
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

        // Find a replacement with the same protein type to maintain variety
        const pool =
          proteinType === 'fish'
            ? candidatePools.fish
            : proteinType === 'legume'
              ? candidatePools.legume
              : candidatePools.any

        const replacement = findReplacementWithSameProtein(pool, usedMealIds, proteinType)
        if (!replacement) {
          // Fall back to any pool
          const anyReplacement = findReplacement(candidatePools.any, usedMealIds)
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
