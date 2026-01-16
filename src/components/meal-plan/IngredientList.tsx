import { Body, Ul, Li } from '@/components/ui/typography'
import type { MealComponent } from './types'

interface IngredientListProps {
  components: MealComponent[]
  householdSize: number
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

export function IngredientList({ components, householdSize }: IngredientListProps) {
  return (
    <div className="flex flex-col gap-3">
      <Body variant="small" className="font-semibold">
        Ingredients (serves {householdSize})
      </Body>
      <Ul className="my-0 ml-4">
        {components.map((comp) => (
          <Li key={comp.ingredient.name} className="flex justify-between gap-4">
            <span>{comp.ingredient.name}</span>
            <span className="text-muted-foreground whitespace-nowrap">
              {formatQuantity(
                comp.quantityPerServing,
                householdSize,
                comp.ingredient.defaultUnit,
                comp.ingredient.gramsPerPiece,
              )}
            </span>
          </Li>
        ))}
      </Ul>
    </div>
  )
}
