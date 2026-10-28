import 'server-only'
import { prisma } from '@/lib/prisma'
import type { ProteinType } from '@/generated/prisma/enums'
import { HouseholdMealError } from '@/lib/household-meal-error'
import {
  isProteinOverrideValid,
  resolveProteinType,
  type ComponentForProtein,
} from '@/lib/meal-planning/protein'

/**
 * The household's chosen main protein on a recipe write (HON-1386). A choice
 * the household sends must be in the recipe it is saved with, so a "fish"
 * label cannot land on a chicken soup; `createHouseholdMeal` and
 * `updateHouseholdMeal` refuse it before any write.
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

/**
 * The protein fields for a PATCH that sends a choice without components: the
 * choice is checked against, and resolved over, the stored components.
 */
export async function resolveStoredMealProtein(mealId: string, override: ProteinType | null) {
  const stored = await prisma.mealComponent.findMany({
    where: { mealId },
    select: {
      quantityPerServing: true,
      isVague: true,
      ingredient: {
        select: { proteinType: true, protein: true, defaultUnit: true, gramsPerPiece: true },
      },
    },
  })
  assertProteinOverride(stored, override)
  return resolveProteinType(stored, override)
}
