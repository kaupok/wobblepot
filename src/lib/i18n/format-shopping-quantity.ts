import type { Unit } from '@/generated/prisma/enums'
import { formatQuantity, formatInteger } from './format-number'
import type { Locale } from './locales'

/**
 * Format a shopping-list quantity for display in the active locale.
 *
 * `quantity` is in the ingredient's `defaultUnit`, the unit
 * `MealComponent.quantityPerServing` is stored in (HON-713).
 *
 * - Vague: returns the original phrase (e.g. "to taste") unchanged.
 * - Pieces: the quantity is already a piece count; rounded up so the shopper
 *   buys enough.
 * - Grams: renders `<n>g` for sub-kilogram amounts, `<n>kg` for >= 1000g, with
 *   one fraction digit at most (whole kilograms collapse to e.g. `2kg`).
 *
 * Decimal separator and thousands grouping follow `locale`: `1.5kg` in `en`,
 * `1,5kg` in `et`.
 */
export function formatShoppingQuantity(
  quantity: number,
  unit: Unit,
  locale: Locale,
  isVague?: boolean,
  originalPhrase?: string | null,
): string {
  if (isVague && originalPhrase) {
    return originalPhrase
  }

  if (unit === 'piece') {
    // The epsilon absorbs float residue from `total / servings * servings`
    // (8 / 3 * 3 is 8.000000000000002), which would otherwise round up to 9.
    return formatInteger(Math.ceil(quantity - 1e-9), locale)
  }

  if (quantity >= 1000) {
    const kg = quantity / 1000
    return `${formatQuantity(kg, locale, { maximumFractionDigits: 1 })}kg`
  }

  return `${formatInteger(quantity, locale)}g`
}
