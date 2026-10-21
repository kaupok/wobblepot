/**
 * A whole spice or leaf that a recipe counts in pieces ("2 bay leaves",
 * "4 cardamom pods") needs `gramsPerPiece`, run by `pnpm db:validate` from
 * `validateIngredientFields`.
 *
 * These rows are gram-counted (`defaultUnit: 'g'`), so without it
 * `convertQuantity` falls back to 30 g a piece and "2 bay leaves" imports as
 * 60 g instead of 0.4 g. Most herbs and spices are measured by weight or
 * spoon, so the rule names its rows rather than keying on a subcategory.
 *
 * Kept out of `seed-validator.ts` because that script runs `main()` on import,
 * so a test cannot load it.
 */

import type { IngredientInput } from './seed-types'

export const PIECE_COUNTED_SPICES = [
  'bay leaves',
  'kaffir lime leaves',
  'curry leaves',
  'cloves',
  'cardamom',
  'star anise',
  'juniper berry',
  'allspice',
  'thai chilli',
  'guajillo chilli',
  'pasilla chilli',
  'arbol chilli',
] as const

export function validatePieceSpiceGramsPerPiece(ingredients: IngredientInput[]): string[] {
  return PIECE_COUNTED_SPICES.flatMap((name) => {
    const ing = ingredients.find((row) => row.name === name)
    if (!ing) return [`${name}: listed in PIECE_COUNTED_SPICES but has no seed row`]
    if (ing.gramsPerPiece == null) {
      return [`${name}: missing 'gramsPerPiece' (a recipe counts it in pieces)`]
    }
    return []
  })
}
