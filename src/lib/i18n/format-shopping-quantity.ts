import { formatQuantity, formatInteger } from './format-number'
import type { Locale } from './locales'
import { formatVaguePhrase, type VaguePhraseLabel } from './vague-phrase'

/**
 * The unit a quantity is shown in. Storage has only `g` and `piece`; `ml` is a
 * display unit for an ingredient a cook measures by volume (HON-1054).
 */
export type DisplayUnit = 'g' | 'ml' | 'piece'

/**
 * Choose the unit an ingredient's quantity is shown in. Every screen that
 * shows a quantity calls this, so no screen keeps its own copy of the rule.
 *
 * An ingredient with `measuredByVolume` shows its stored grams as millilitres,
 * 1 g = 1 ml, because recipe import and the seeds store 1 ml as 1 g
 * (HON-1054). An absent flag reads as grams, which is the rule for
 * household-owned ingredients.
 */
export function displayUnit(ingredient: {
  defaultUnit: string
  measuredByVolume?: boolean
}): DisplayUnit {
  if (ingredient.defaultUnit === 'piece') return 'piece'
  return ingredient.measuredByVolume ? 'ml' : 'g'
}

/**
 * Format a shopping-list quantity for display in the active locale.
 *
 * `quantity` is in the ingredient's `defaultUnit`, the unit
 * `MealComponent.quantityPerServing` is stored in (HON-713); `unit` is
 * `displayUnit(ingredient)`.
 *
 * - Vague: returns the phrase in the household's language through `tVague`
 *   (the `enums.VaguePhrase` translator); a phrase outside the vocabulary
 *   passes through unchanged.
 * - Pieces: the quantity is already a piece count; rounded up so the shopper
 *   buys enough, and labelled with `pieceLabel` (`enums.Unit.piece`): `1 pc`,
 *   `1 tk` (HON-956).
 * - Grams: `formatWeight` — `<n>g` below 1000g, `<n>kg` from there on.
 * - Millilitres: `formatVolume` — `<n>ml` below 1000ml, `<n>l` from there on.
 *
 * Decimal separator and thousands grouping follow `locale`: `1.5kg` in `en`,
 * `1,5kg` in `et`.
 */
export function formatShoppingQuantity(
  quantity: number,
  unit: DisplayUnit,
  locale: Locale,
  isVague: boolean,
  originalPhrase: string | null,
  tVague: VaguePhraseLabel,
  pieceLabel: string,
): string {
  if (isVague && originalPhrase) {
    return formatVaguePhrase(originalPhrase, tVague)
  }

  if (unit === 'piece') {
    // The epsilon absorbs float residue from `total / servings * servings`
    // (8 / 3 * 3 is 8.000000000000002), which would otherwise round up to 9.
    return withPieceUnit(formatInteger(Math.ceil(quantity - 1e-9), locale), pieceLabel)
  }

  return formatMeasure(quantity, unit, locale)
}

/** `formatVolume` for `ml`, `formatWeight` for `g`. */
export function formatMeasure(quantity: number, unit: 'g' | 'ml', locale: Locale): string {
  return unit === 'ml' ? formatVolume(quantity, locale) : formatWeight(quantity, locale)
}

/**
 * Format a weight in grams: `<n>g` below 1000g, `<n>kg` at 1000g and above,
 * with one fraction digit at most (whole kilograms collapse to e.g. `2kg`).
 * Shared by the shopping list, the pantry and the cook view, so one weight
 * reads the same everywhere (HON-950).
 */
export function formatWeight(grams: number, locale: Locale): string {
  // 999.5g and up would round to "1,000g" on the gram path.
  if (grams >= 999.5) {
    return `${formatQuantity(grams / 1000, locale, { maximumFractionDigits: 1 })}kg`
  }

  return `${formatInteger(grams, locale)}g`
}

/**
 * Format a volume in millilitres: `<n>ml` below 1000ml, `<n>l` at 1000ml and
 * above, with one fraction digit at most (whole litres collapse to e.g. `2l`).
 * The same shape as `formatWeight` (HON-1054).
 */
export function formatVolume(ml: number, locale: Locale): string {
  // 999.5ml and up would round to "1,000ml" on the millilitre path.
  if (ml >= 999.5) {
    return `${formatQuantity(ml / 1000, locale, { maximumFractionDigits: 1 })}l`
  }

  return `${formatInteger(ml, locale)}ml`
}

/**
 * Join a formatted piece count and its label: `1 pc`, `1,5 tk`. The no-break
 * space keeps the unit on the number's line (HON-956). Shared by the shopping
 * list, the pantry and the cook view.
 */
export function withPieceUnit(amount: string, pieceLabel: string): string {
  return `${amount}\u00a0${pieceLabel}`
}
