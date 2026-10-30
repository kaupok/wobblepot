/**
 * An ingredient's nutrition is for the form you buy it in (HON-1473). A
 * bone-in cut or a whole fish is bought, weighed and listed with its bone, so
 * its row holds values per 100 g as bought: the raw edible values × the edible
 * part (HON-1479). The shopping list, the pantry and the nutrition then read
 * the same grams.
 *
 * Each bone-in or whole row in the seed files calls this with the raw values
 * and the edible part from a cited source, so an audit sees why the stored
 * values sit below the raw meat values and does not "correct" them back.
 */

export type Nutrition = {
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
}

const oneDecimal = (value: number) => Math.round(value * 10) / 10

/** `ediblePart` is the share of the bought weight you eat, above 0 and at most 1. */
export function asSold(raw: Nutrition, ediblePart: number): Nutrition {
  if (!(ediblePart > 0 && ediblePart <= 1)) {
    throw new RangeError(`ediblePart must be above 0 and at most 1, got ${ediblePart}`)
  }
  return {
    calories: oneDecimal(raw.calories * ediblePart),
    protein: oneDecimal(raw.protein * ediblePart),
    carbs: oneDecimal(raw.carbs * ediblePart),
    fat: oneDecimal(raw.fat * ediblePart),
    fiber: oneDecimal(raw.fiber * ediblePart),
  }
}
