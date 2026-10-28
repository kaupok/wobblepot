import 'server-only'
import type { ProteinType } from '@/generated/prisma/enums'
import { HouseholdMealError } from '@/lib/household-meal-error'
import { isProteinOverrideValid, type ComponentForProtein } from '@/lib/meal-planning/protein'

/**
 * The household's chosen main protein on a recipe write (HON-1386). A choice
 * the household sends must be in the recipe it is saved with, so a "fish"
 * label cannot land on a chicken soup; `createHouseholdMeal` and
 * `updateHouseholdMeal` refuse it, and nothing is written.
 */

/** Refuse a sent choice that no non-vague component carries. */
export function assertProteinOverride(
  components: ComponentForProtein[],
  override: ProteinType | null | undefined,
) {
  if (override && !isProteinOverrideValid(components, override)) {
    throw new HouseholdMealError('proteinTypeNotInRecipe')
  }
}
