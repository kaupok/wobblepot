import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import type { MealAvailability, MealData, PantryIngredient } from './types'

interface AvailabilityIndicatorProps {
  availability: MealAvailability
  /** `lg` in the cook view's ingredients header (HON-932) */
  size?: 'default' | 'lg'
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
 * Whether the pantry says anything about a meal. Staples alone do not count:
 * every household starts with salt, black pepper and water as staples
 * (HON-769), so counting them would mark every other ingredient missing for a
 * household that has never used the pantry.
 */
export function hasPantryData(pantryIngredients: PantryIngredient[] | undefined): boolean {
  return pantryIngredients?.some((p) => !p.isStaple) ?? false
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

/**
 * The pantry's verdict on a meal, as a `surface` badge: the same pill as the
 * slot and protein badges above it, on the page background rather than the
 * meal's chip colour, because the pantry's status is not the meal's own
 * (docs/DESIGN.md → Color). The text names the state; colour is not the only cue.
 */
export function AvailabilityIndicator({ availability, size }: AvailabilityIndicatorProps) {
  const t = useTranslations('meal-plan.availability')

  if (availability.isReady) {
    return (
      <Badge variant="surface-success" size={size}>
        {t('haveAll')}
      </Badge>
    )
  }

  return (
    <Badge variant="surface-warning" size={size}>
      {t('toBuy', { count: availability.missingCount })}
    </Badge>
  )
}
