/**
 * A wrapper row (wonton, spring roll, rice paper) needs `gramsPerPiece`, run
 * by `pnpm db:validate` from `validateIngredientFields`.
 *
 * A recipe always counts wrappers in pieces, so without it `convertQuantity`
 * falls back to 30 g a piece and a wonton soup card shows double the calories.
 *
 * Kept out of `seed-validator.ts` because that script runs `main()` on import,
 * so a test cannot load it.
 */

import type { IngredientInput } from './seed-types'

export function validateWrapperGramsPerPiece(ingredients: IngredientInput[]): string[] {
  return ingredients
    .filter((ing) => ing.subcategory === 'wrapper' && ing.gramsPerPiece == null)
    .map(
      (ing) =>
        `${ing.name}: missing 'gramsPerPiece' (required for subcategory 'wrapper', which a recipe counts in pieces)`,
    )
}
