import type { MealAvailability, MealData, PantryIngredient } from './types'

interface AvailabilityIndicatorProps {
  availability: MealAvailability
}

/**
 * Build sets of available ingredient IDs and staple IDs from pantry data.
 * Shared by MealCardBase (compact color-coding) and IngredientList (interactive checkboxes).
 */
export function getIngredientAvailabilitySets(pantryIngredients: PantryIngredient[]): {
  availableIds: Set<string>
  stapleIds: Set<string>
} {
  return {
    availableIds: new Set(pantryIngredients.map((p) => p.ingredientId)),
    stapleIds: new Set(pantryIngredients.filter((p) => p.isStaple).map((p) => p.ingredientId)),
  }
}

/**
 * Compute meal availability based on pantry contents.
 * An ingredient is considered available if it exists in the pantry
 * (regardless of quantity). Staples are always considered available
 * and are excluded from missing ingredient counts.
 */
export function computeMealAvailability(
  meal: MealData,
  pantryIngredients: PantryIngredient[],
): MealAvailability {
  const { availableIds, stapleIds } = getIngredientAvailabilitySets(pantryIngredients)

  const missingIngredients: string[] = []

  for (const component of meal.components) {
    // Staples are always assumed in stock, skip them
    if (stapleIds.has(component.ingredientId)) {
      continue
    }
    if (!availableIds.has(component.ingredientId)) {
      missingIngredients.push(component.ingredient.name)
    }
  }

  return {
    isReady: missingIngredients.length === 0,
    missingCount: missingIngredients.length,
    missingIngredients,
  }
}

export function AvailabilityIndicator({ availability }: AvailabilityIndicatorProps) {
  if (availability.isReady) {
    return (
      <span className="inline-flex items-center justify-center rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
        Have all ingredients
      </span>
    )
  }

  return (
    <span className="inline-flex items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
      {availability.missingCount} ingredients missing
    </span>
  )
}
