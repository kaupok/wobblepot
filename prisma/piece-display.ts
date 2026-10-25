// Which global gram-stored ingredients show as pieces (HON-1312). Display
// only: storage, nutrition, pantry deduction and shopping sums stay in grams.
// The seed sets `Ingredient.pieceDisplay` from this rule. Migration
// 20261025120000_add_ingredient_piece_display repeats the two lists by hand,
// because a migration cannot import TypeScript; piece-display.test.ts fails
// when the two copies differ, or when a listed name has no `gramsPerPiece`.
//
// Names match exactly, case-sensitive, as the seeds spell them.

import type { PieceDisplay } from '../src/generated/prisma/enums'

/** Whole vegetables a shopper picks one by one: pieces in the recipe and on the list. */
export const PIECES_IN_RECIPE_AND_SHOPPING_NAMES: ReadonlySet<string> = new Set([
  'onion',
  'carrot',
  'tomato',
  'garlic',
  'bell pepper',
  'red pepper',
  'cucumber',
  'courgette',
])

/** Cooked by the piece but sold loose by weight: pieces in the recipe, grams on the list. */
export const PIECES_IN_RECIPE_ONLY_NAMES: ReadonlySet<string> = new Set(['potato', 'sweet potato'])

export function pieceDisplayFor({ name }: { name: string }): PieceDisplay {
  if (PIECES_IN_RECIPE_AND_SHOPPING_NAMES.has(name)) return 'recipe_and_shopping'
  if (PIECES_IN_RECIPE_ONLY_NAMES.has(name)) return 'recipe'
  return 'none'
}
