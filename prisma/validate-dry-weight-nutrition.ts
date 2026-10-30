/**
 * An ingredient's nutrition is for the form you buy it in, so a dry grain,
 * pasta, rice, noodle or lentil row holds dry values. Recipes give these in
 * dry grams; a row with cooked values (about 130 kcal) shows a third of the
 * real carbs and kcal per serving (HON-1473). Run by `pnpm db:validate` as a
 * warning, because a few rows in these subcategories are sold fresh or
 * pre-cooked.
 *
 * Kept out of `seed-validator.ts` because that script runs `main()` on import,
 * so a test cannot load it.
 */

import type { IngredientInput } from './seed-types'

/** Dry grains, pasta, rice and lentils all sit above 300 kcal per 100 g. */
export const DRY_WEIGHT_MIN_CALORIES = 250

const DRY_SUBCATEGORIES = new Set(['grain', 'pasta', 'rice', 'noodle', 'lentil', 'lentils'])

/** Sold fresh or pre-cooked, so the as-bought values are below the floor. */
export const AS_SOLD_EXCEPTIONS = new Set(['gnocchi', 'udon noodles', 'tteok'])

function isDryGood(ing: IngredientInput): boolean {
  const subcategory = ing.subcategory ?? ''
  if (DRY_SUBCATEGORIES.has(subcategory)) return true
  return (subcategory === 'pea' || subcategory === 'peas') && ing.name.includes('split')
}

export function validateDryWeightNutrition(ingredients: IngredientInput[]): string[] {
  return ingredients
    .filter((ing) => isDryGood(ing) && !AS_SOLD_EXCEPTIONS.has(ing.name))
    .filter((ing) => ing.calories < DRY_WEIGHT_MIN_CALORIES)
    .map(
      (ing) =>
        `${ing.name}: ${ing.calories} kcal per 100 g looks cooked; a ${ing.subcategory} row holds dry, as-bought values`,
    )
}
