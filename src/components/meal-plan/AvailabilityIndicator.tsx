import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Body } from '@/components/ui/typography'
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
export function AvailabilityIndicator({ availability }: AvailabilityIndicatorProps) {
  const t = useTranslations('meal-plan.availability')

  if (availability.isReady) {
    return <Badge variant="surface-success">{t('haveAll')}</Badge>
  }

  return <Badge variant="surface-warning">{t('toBuy', { count: availability.missingCount })}</Badge>
}

/**
 * The same verdict as plain text, for the cook view's Ingredients line
 * (HON-1025): "1 to buy" or "all at home" after the heading. A pill there had
 * the shape of the meal's own badges, so it read as a fact about the meal, not
 * the state of the list. The warning tone matches the missing rows below it,
 * and the words name the state, so colour is not the only cue.
 */
export function AvailabilityStatus({ availability }: AvailabilityIndicatorProps) {
  const t = useTranslations('meal-plan.availability')

  if (availability.isReady) {
    return (
      <Body variant="small" tone="success" className="whitespace-nowrap">
        {t('haveAllShort')}
      </Body>
    )
  }

  return (
    <Body variant="small" tone="warning" className="whitespace-nowrap">
      {t('toBuyShort', { count: availability.missingCount })}
    </Body>
  )
}
