import { Check } from 'lucide-react'
import type { MealAvailability, MealData, PantryIngredient } from './types'

interface AvailabilityIndicatorProps {
  availability: MealAvailability
}

/**
 * Compute meal availability based on pantry contents.
 * An ingredient is considered available if it exists in the pantry
 * (regardless of quantity). Staples are included in the pantry list
 * when passed from the caller.
 */
export function computeMealAvailability(
  meal: MealData,
  pantryIngredients: PantryIngredient[],
): MealAvailability {
  // Build a set of available ingredient IDs (including staples)
  const availableIds = new Set(pantryIngredients.map((p) => p.ingredientId))

  const missingIngredients: string[] = []

  for (const component of meal.components) {
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
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
        <Check className="h-2.5 w-2.5" />
        Ready
      </span>
    )
  }

  return (
    <span className="text-muted-foreground inline-flex items-center gap-0.5 text-[10px]">
      <span aria-hidden="true">🛒</span>
      <span>{availability.missingCount}</span>
      <span className="sr-only">missing ingredients</span>
    </span>
  )
}
