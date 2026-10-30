import type { PieceDisplay } from '@/generated/prisma/enums'

import { formatInteger } from './format-number'
import { displayUnit, formatShoppingQuantity, withPieceUnit } from './format-shopping-quantity'
import type { Locale } from './locales'
import type { VaguePhraseLabel } from './vague-phrase'

/**
 * The fields that decide whether a gram-stored ingredient shows as pieces
 * (HON-1312). An absent `pieceDisplay` reads as `none`, the rule for
 * household-owned ingredients and for loaders that do not select it.
 */
export interface PieceDisplayIngredient {
  defaultUnit: string
  measuredByVolume?: boolean
  gramsPerPiece?: number | null
  pieceDisplay?: PieceDisplay
}

/** Grams per piece when the rule applies, or null for the gram or ml display. */
function piecesRule(
  ingredient: PieceDisplayIngredient,
  where: 'recipe' | 'shopping',
): number | null {
  const { defaultUnit, measuredByVolume, gramsPerPiece, pieceDisplay } = ingredient
  if (defaultUnit !== 'g' || measuredByVolume) return null
  if (gramsPerPiece == null || gramsPerPiece <= 0) return null
  if (pieceDisplay === 'recipe_and_shopping') return gramsPerPiece
  if (pieceDisplay === 'recipe' && where === 'recipe') return gramsPerPiece
  return null
}

/** A recipe's piece hint: the rounded count, and whether it differs from the grams. */
export interface RecipePieceCount {
  pieces: number
  /** The count is off the exact grams by more than 0.05 pieces, so it shows as "~3". */
  approximate: boolean
}

/** A piece this heavy or heavier is cut in half and the rest kept: "½ onion". */
const HALVES_FROM_GRAMS_PER_PIECE = 100

/**
 * The piece count a recipe shows for `grams` (HON-1474). A big piece (100 g
 * or more) rounds to the nearest half below 1¾, with ½ as the minimum, and to
 * the nearest whole from there up: 165 g onion (110 g each) is 1½, 190 g is
 * ~2. A small piece (carrot, garlic clove) rounds to the nearest whole, with 1
 * as the minimum. The 1¾ threshold reads the count rounded to a quarter, so
 * 190 g onion (1.73) is past it. Null when the ingredient shows in grams.
 * Display only: the stored grams do not change.
 */
export function recipePieceCount(
  grams: number,
  ingredient: PieceDisplayIngredient,
): RecipePieceCount | null {
  const perPiece = piecesRule(ingredient, 'recipe')
  if (perPiece == null || grams <= 0) return null
  const exact = grams / perPiece
  const halves = perPiece >= HALVES_FROM_GRAMS_PER_PIECE && Math.round(exact * 4) / 4 < 1.75
  const pieces = halves ? Math.max(0.5, Math.round(exact * 2) / 2) : Math.max(1, Math.round(exact))
  return { pieces, approximate: Math.abs(pieces - exact) > 0.05 }
}

/**
 * The piece count the shopping list shows for `grams`, rounded up to whole
 * pieces so the shopper buys enough: 83 g onion is 1. The caller passes the
 * grams summed across meals with the pantry subtracted, so three meals of 30 g
 * onion need 1 onion, not 3. Null for `recipe` ingredients (potatoes are sold
 * by weight) and for every ingredient that shows in grams.
 */
export function shoppingPieceCount(
  grams: number,
  ingredient: PieceDisplayIngredient,
): number | null {
  const perPiece = piecesRule(ingredient, 'shopping')
  if (perPiece == null || grams <= 0) return null
  // The epsilon absorbs float residue, as in `formatShoppingQuantity`.
  return Math.ceil(grams / perPiece - 1e-9)
}

/**
 * Format a recipe piece count with the half glyph: `½`, `1½`, `2`, and `~3`
 * when approximate. The `~` takes no space in every locale; the integer part
 * follows `locale`.
 */
export function formatPieceFraction({ pieces, approximate }: RecipePieceCount, locale: Locale) {
  const whole = Math.floor(pieces)
  const half = pieces - whole >= 0.5 ? '½' : ''
  const count = whole === 0 ? half : `${formatInteger(whole, locale)}${half}`
  return approximate ? `~${count}` : count
}

/**
 * A shopping-list line's quantity: whole pieces for an ingredient the shopper
 * picks one by one ("1 pc"), otherwise `formatShoppingQuantity`. `quantity` is
 * the stored grams after summing and the pantry deduction. The shopping page,
 * the dashboard panel and the sample weeks all call this, so they cannot
 * disagree.
 */
export function formatShoppingLineQuantity(
  quantity: number,
  ingredient: PieceDisplayIngredient,
  locale: Locale,
  isVague: boolean,
  originalPhrase: string | null,
  tVague: VaguePhraseLabel,
  pieceLabel: string,
): string {
  const pieces = isVague && originalPhrase ? null : shoppingPieceCount(quantity, ingredient)
  if (pieces != null) return withPieceUnit(formatInteger(pieces, locale), pieceLabel)
  return formatShoppingQuantity(
    quantity,
    displayUnit(ingredient),
    locale,
    isVague,
    originalPhrase,
    tVague,
    pieceLabel,
  )
}
