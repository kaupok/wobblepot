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

/**
 * The piece count a recipe shows for `grams`, rounded to the nearest quarter
 * with ¼ as the minimum: 83 g onion (110 g each) is ¾. Null when the
 * ingredient shows in grams. Display only: the stored grams do not change.
 */
export function recipePieceCount(grams: number, ingredient: PieceDisplayIngredient): number | null {
  const perPiece = piecesRule(ingredient, 'recipe')
  if (perPiece == null || grams <= 0) return null
  return Math.max(0.25, Math.round((grams / perPiece) * 4) / 4)
}

/**
 * The piece count the shopping list shows for `grams`, rounded up to whole
 * pieces so the shopper buys enough: 83 g onion is 1. The caller passes the
 * grams summed across meals with the pantry subtracted, so three meals of ¼
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

const QUARTERS = ['', '¼', '½', '¾'] as const

/**
 * Format a quarter-rounded piece count with a fraction glyph: `¾`, `1½`, `2`.
 * The integer part follows `locale`.
 */
export function formatPieceFraction(pieces: number, locale: Locale): string {
  const quarters = Math.round(pieces * 4)
  const whole = Math.floor(quarters / 4)
  const fraction = QUARTERS[quarters % 4]
  if (whole === 0) return fraction || formatInteger(0, locale)
  return `${formatInteger(whole, locale)}${fraction}`
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
