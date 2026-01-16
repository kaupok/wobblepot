import { Check, AlertTriangle } from 'lucide-react'
import type { MealAvailability, MealData, PantryIngredient } from './types'

interface AvailabilityIndicatorProps {
  availability: MealAvailability
}

/**
 * Compute meal availability based on pantry contents.
 * An ingredient is considered available if:
 * - It exists in the pantry (regardless of quantity), OR
 * - It's marked as a staple (always in stock)
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
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
        <Check className="h-3 w-3" />
        Ready to cook
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
      <AlertTriangle className="h-3 w-3" />
      Missing {availability.missingCount} {availability.missingCount === 1 ? 'item' : 'items'}
    </span>
  )
}
