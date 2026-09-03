import { useTranslations } from 'next-intl'
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
  const t = useTranslations('meal-plan.availability')

  if (availability.isReady) {
    return (
      <span className="bg-success-muted text-success inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium">
        {t('haveAll')}
      </span>
    )
  }

  return (
    <span className="bg-warning-muted text-warning inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium">
      {t('missing', { count: availability.missingCount })}
    </span>
  )
}
