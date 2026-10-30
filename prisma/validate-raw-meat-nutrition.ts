/**
 * An ingredient's nutrition is for the form you buy it in, so a meat or
 * poultry row holds raw values (HON-1479). Raw muscle meat stays under 24 g
 * protein per 100 g; roasted or grilled values are 25-31 g, because the meat
 * lost water. A row above the ceiling shows about a third more protein per
 * serving than the household eats. Run by `pnpm db:validate` as a warning.
 *
 * Kept out of `seed-validator.ts` because that script runs `main()` on import,
 * so a test cannot load it.
 */

import type { IngredientInput } from './seed-types'

export const RAW_MEAT_MAX_PROTEIN = 24

const MEAT_SUBCATEGORIES = new Set([
  'poultry',
  'beef',
  'pork',
  'lamb',
  'veal',
  'game',
  'offal',
  'cured meat',
])

/** Cured, dried or cooked as sold, so the as-bought values are above the ceiling. */
export const CURED_MEAT_EXCEPTIONS = new Set([
  'prosciutto',
  'speck',
  'bresaola',
  'beef jerky',
  'carne seca',
  'salami',
  'chorizo',
  'pepperoni',
  'ham',
  'corned beef',
  'duck confit',
])

export function validateRawMeatNutrition(ingredients: IngredientInput[]): string[] {
  return ingredients
    .filter((ing) => MEAT_SUBCATEGORIES.has(ing.subcategory ?? ''))
    .filter((ing) => !CURED_MEAT_EXCEPTIONS.has(ing.name))
    .filter((ing) => ing.protein > RAW_MEAT_MAX_PROTEIN)
    .map(
      (ing) =>
        `${ing.name}: ${ing.protein} g protein per 100 g looks cooked; a ${ing.subcategory} row holds raw, as-bought values`,
    )
}
