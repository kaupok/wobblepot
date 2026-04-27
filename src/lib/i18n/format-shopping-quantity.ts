import type { Unit } from '@/generated/prisma/enums'
import { formatQuantity, formatInteger } from './format-number'
import type { Locale } from './locales'

/**
 * Format a shopping-list quantity for display in the active locale.
 *
 * - Vague: returns the original phrase (e.g. "to taste") unchanged.
 * - Pieces: converts grams to a piece count via `gramsPerPiece`, rounded up so
 *   the shopper buys enough; falls back to the gram path if `gramsPerPiece` is
 *   missing.
 * - Grams: renders `<n>g` for sub-kilogram amounts, `<n>kg` for >= 1000g, with
 *   one fraction digit at most (whole kilograms collapse to e.g. `2kg`).
 *
 * Decimal separator and thousands grouping follow `locale`: `1.5kg` in `en`,
 * `1,5kg` in `et`. Quantities are stored in grams.
 */
export function formatShoppingQuantity(
  qtyInGrams: number,
  unit: Unit,
  gramsPerPiece: number | null,
  locale: Locale,
  isVague?: boolean,
  originalPhrase?: string | null,
): string {
  if (isVague && originalPhrase) {
    return originalPhrase
  }

  if (unit === 'piece' && gramsPerPiece && gramsPerPiece > 0) {
    const pieces = Math.ceil(qtyInGrams / gramsPerPiece)
    return formatInteger(pieces, locale)
  }

  if (qtyInGrams >= 1000) {
    const kg = qtyInGrams / 1000
    return `${formatQuantity(kg, locale, { maximumFractionDigits: 1 })}kg`
  }

  return `${formatInteger(qtyInGrams, locale)}g`
}
