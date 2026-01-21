import { Body, Ul, Li } from '@/components/ui/typography'
import type { MealComponent, PantryIngredient } from './types'

interface IngredientListProps {
  components: MealComponent[]
  householdSize: number
  pantryIngredients?: PantryIngredient[]
}

/**
 * Format quantity for display in meal detail view.
 *
 * Note: Quantities are stored in grams for all ingredients.
 * When defaultUnit is 'piece', we convert using gramsPerPiece.
 */
function formatQuantity(
  quantityPerServingInGrams: number,
  householdSize: number,
  unit: 'g' | 'piece',
  gramsPerPiece: number | null | undefined,
): string {
  const totalQuantityInGrams = quantityPerServingInGrams * householdSize

  if (unit === 'piece') {
    // Convert grams to pieces
    if (gramsPerPiece && gramsPerPiece > 0) {
      const pieces = totalQuantityInGrams / gramsPerPiece
      // Round to one decimal for display, remove .0 for whole numbers
      const rounded = Math.round(pieces * 10) / 10
      return rounded % 1 === 0 ? String(Math.floor(rounded)) : rounded.toFixed(1)
    }
    // Fallback: if no gramsPerPiece, show as grams
    return `${Math.round(totalQuantityInGrams)}g`
  }

  // For grams, round to nearest integer and add unit
  return `${Math.round(totalQuantityInGrams)}g`
}

export function IngredientList({
  components,
  householdSize,
  pantryIngredients,
}: IngredientListProps) {
  // Build set of available ingredient IDs for missing item highlighting
  const availableIds = pantryIngredients
    ? new Set(pantryIngredients.map((p) => p.ingredientId))
    : null

  return (
    <div className="flex flex-col gap-3">
      <Body variant="small" className="font-semibold">
        Ingredients (serves {householdSize})
      </Body>
      <Ul className="my-0 ml-4">
        {components.map((comp) => {
          const isMissing = availableIds && !availableIds.has(comp.ingredientId)
          return (
            <Li
              key={comp.ingredient.name}
              className={`flex justify-between gap-4 ${isMissing ? 'text-amber-600 dark:text-amber-400' : ''}`}
            >
              <span>{comp.ingredient.name}</span>
              <span
                className={`whitespace-nowrap ${isMissing ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
              >
                {formatQuantity(
                  comp.quantityPerServing,
                  householdSize,
                  comp.ingredient.defaultUnit,
                  comp.ingredient.gramsPerPiece,
                )}
              </span>
            </Li>
          )
        })}
      </Ul>
    </div>
  )
}
