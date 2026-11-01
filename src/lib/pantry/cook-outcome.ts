import type { IngredientCategory, Unit } from '@/generated/prisma/enums'

/**
 * What cooking a meal does to one pantry row (HON-1563).
 *
 * - `subtract`: a known quantity loses what the meal used.
 * - `usedUp`: a "have some" row (`quantity: null`) ran out, so it goes to `0`,
 *   the pantry's Ran out state (HON-1399).
 * - `someLeft`: a "have some" row stays as it is.
 *
 * Pure, with no `server-only`: the server deduction and the client's
 * deduction dialog both call it.
 */
export type CookOutcome = 'subtract' | 'usedUp' | 'someLeft'

/** The `carb` subcategories a household keeps in a cupboard pack. */
const CUPBOARD_CARB_SUBCATEGORIES: ReadonlySet<string> = new Set([
  'grain',
  'rice',
  'pasta',
  'noodle',
  'flour',
  'starch',
  'cereal',
  'sweetener',
  'baking',
  'baking mix',
  'bran',
])

/**
 * A cupboard ingredient comes in a pack that one meal rarely finishes: a
 * spice, a sauce, an oil, dried beans, a bag of flour. The category is a proxy
 * for pack size, which the data does not have.
 */
export function isCupboardIngredient(
  category: IngredientCategory,
  subcategory: string | null,
): boolean {
  switch (category) {
    // Fresh dill and coriander are `spice/herb`; `dried herb` stays cupboard.
    case 'spice':
      return subcategory !== 'herb'
    case 'condiment':
    case 'fat':
      return true
    // Fresh and frozen peas and green beans are `legume-vegetable`.
    case 'legume':
      return subcategory !== 'legume-vegetable'
    case 'carb':
      return subcategory !== null && CUPBOARD_CARB_SUBCATEGORIES.has(subcategory)
    default:
      return false
  }
}

/**
 * The outcome a cooked meal gives a pantry row when the cook has not chosen
 * one. Null: the row is not touched (a staple is never deducted).
 *
 * When unsure the rule says `usedUp`, because a wrong "used up" puts a line
 * on the shopping list that the shopper skips, while a wrong "some left"
 * leaves a dinner short. No amount threshold: 40 g of fresh dill is used up
 * and 40 g of flour is not.
 */
export function defaultCookOutcome(input: {
  pantryQuantity: number | null
  isStaple: boolean
  category: IngredientCategory
  subcategory: string | null
  defaultUnit: Unit
  /** `quantityPerServing` × servings, in the ingredient's `defaultUnit`. */
  amountUsed: number
}): CookOutcome | null {
  if (input.isStaple) return null
  if (input.pantryQuantity !== null) return 'subtract'
  if (isCupboardIngredient(input.category, input.subcategory)) return 'someLeft'
  // Half a lemon leaves half a lemon.
  if (input.defaultUnit === 'piece' && input.amountUsed < 1) return 'someLeft'
  return 'usedUp'
}

/** The ingredient fields `defaultCookOutcome` reads, as a Prisma `select`. */
export const COOK_OUTCOME_INGREDIENT_SELECT = {
  id: true,
  category: true,
  subcategory: true,
  defaultUnit: true,
} as const
