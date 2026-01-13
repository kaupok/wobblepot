import { Body, Ul, Li } from '@/components/ui/typography'
import type { MealComponent } from './types'

interface IngredientListProps {
  components: MealComponent[]
  householdSize: number
}

function formatQuantity(
  quantityPerServing: number,
  householdSize: number,
  unit: 'g' | 'piece',
): string {
  const totalQuantity = quantityPerServing * householdSize

  if (unit === 'piece') {
    // For pieces, round to one decimal if not whole
    const rounded = Math.round(totalQuantity * 10) / 10
    return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1)
  }

  // For grams, round to nearest integer and add unit
  return `${Math.round(totalQuantity)}g`
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
              {formatQuantity(comp.quantityPerServing, householdSize, comp.ingredient.defaultUnit)}
            </span>
          </Li>
        ))}
      </Ul>
    </div>
  )
}
