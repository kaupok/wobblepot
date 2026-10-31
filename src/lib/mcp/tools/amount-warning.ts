import type { MatchedIngredient } from '@/lib/ai/match-ingredients'

import type { MeasuredUnit } from './measured-units'

/**
 * Why a sure match's amount needs the user's word before it is saved, or null
 * (`add_extra`, `change_meal_ingredients`, `add_to_pantry`). The assistant converts units
 * itself, so the risky amount is one that crosses between pieces and weight
 * or volume: Wobblepot guesses 30 g a piece when it does not know the weight,
 * and the matcher's `quantityWarning` flags an amount that is unusually high.
 * An amount in the ingredient's own unit is saved as given, because the user
 * said it so (and `quantityWarning` is a per-serving recipe limit, 500 g, that
 * a day's 750 ml of wine would trip). Sending the amount in that unit clears
 * the check.
 *
 * `converted` is the amount Wobblepot made of `quantity`, in `shown`.
 */
export function amountWarning(
  match: {
    ingredient: Pick<MatchedIngredient['ingredient'], 'defaultUnit' | 'gramsPerPiece'>
    quantityWarning?: string
  },
  name: string,
  quantity: number,
  unit: MeasuredUnit,
  converted: number,
  shown: MeasuredUnit,
): string | null {
  const { defaultUnit, gramsPerPiece } = match.ingredient
  if ((unit === 'piece') === (defaultUnit === 'piece')) return null
  const became = `${quantity} ${unit} became ${converted} ${shown}`
  if (!gramsPerPiece) {
    return `Wobblepot does not know what one piece of ${name} weighs, so ${became} by a guess.`
  }
  return match.quantityWarning ? `${became}, which is unusually high.` : null
}
