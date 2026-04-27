import type { Locale } from './locales'

interface QuantityFormatOptions {
  /** Override the maximum fraction digits. Defaults to 1 (e.g. "1,5"). */
  maximumFractionDigits?: number
  /** Override the minimum fraction digits. Defaults to 0. */
  minimumFractionDigits?: number
}

/**
 * Locale-aware decimal quantity formatter (e.g. "1.5" in en vs. "1,5" in et).
 * Used wherever a recipe / pantry / shopping-list quantity is shown to the user.
 */
export function formatQuantity(
  value: number,
  locale: Locale,
  options: QuantityFormatOptions = {},
): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: options.maximumFractionDigits ?? 1,
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
  }).format(value)
}

/**
 * Locale-aware integer formatter. Picks up locale grouping conventions
 * (e.g. en uses comma as a thousands separator, et uses a non-breaking space).
 * Use for calorie / macro / count values.
 */
export function formatInteger(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(value)
}
