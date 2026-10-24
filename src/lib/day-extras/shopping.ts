import type { AggregationComponent, AggregationEntry } from '@/lib/meal-planning/shopping-list'
import { MIXED_VAGUE_PHRASE } from '@/lib/vague-quantities'

/**
 * A stand-in need for an ingredient extra with no amount (HON-1309). It keeps
 * the line on the list when the pantry has none of it, and a known pantry
 * quantity covers it, as for a meal. The line never shows it: a vague line
 * shows its phrase.
 */
export const NO_AMOUNT_QUANTITY = 1

/**
 * The window's ingredient extras as aggregation entries, one serving each, so
 * they merge with the meals' need for the same ingredient into one line. An
 * extra with no amount is vague, with the phrase a quantity that could not be
 * resolved gets ("some").
 */
export function extraAggregationEntries(
  extras: readonly {
    date: Date
    quantity: number | null
    ingredient: AggregationComponent['ingredient'] | null
  }[],
): AggregationEntry[] {
  return extras.flatMap(({ date, quantity, ingredient }) =>
    ingredient
      ? [
          {
            date,
            servings: 1,
            components: [
              {
                ingredientId: ingredient.id,
                quantityPerServing: quantity ?? NO_AMOUNT_QUANTITY,
                isVague: quantity === null,
                originalPhrase: quantity === null ? MIXED_VAGUE_PHRASE : null,
                ingredient,
              },
            ],
          },
        ]
      : [],
  )
}
