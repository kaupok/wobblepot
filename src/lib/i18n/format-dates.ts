import type { Locale } from './locales'

/**
 * A minimal translator signature that matches both `getTranslations()` (server)
 * and `useTranslations()` (client) from next-intl. Callers pass a translator
 * scoped to the `dates` namespace.
 */
export type DatesTranslator = (
  key: 'today' | 'tomorrow' | 'past' | 'inDays',
  params?: Record<string, string | number>,
) => string

interface DateFormatOptions {
  /**
   * IANA timezone string (e.g. `Europe/Tallinn`). When supplied, the formatter
   * renders the date as it appears in that timezone — important when the
   * household timezone differs from the server / browser local.
   */
  timeZone?: string
}

/**
 * Format a date as an absolute short date (e.g. "Apr 5" / "5. apr").
 */
export function formatAbsoluteDate(
  date: Date,
  locale: Locale,
  options: DateFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: options.timeZone,
  }).format(date)
}

/**
 * Format a compact date range. When start and end fall in the same month the
 * month is rendered once: "Apr 5 – 11" / "5.–11. apr". Different months render
 * the month on each side: "Apr 28 – May 4" / "28. apr – 4. mai".
 */
export function formatDateRange(
  start: Date,
  end: Date,
  locale: Locale,
  options: DateFormatOptions = {},
): string {
  const formatter = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: options.timeZone,
  })
  return formatter.formatRange(start, end)
}

/**
 * Format a date as day + abbreviated month (e.g. "18 Feb" / "18. veebr").
 */
export function formatDayMonth(
  date: Date,
  locale: Locale,
  options: DateFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: options.timeZone,
  }).format(date)
}

/**
 * Format the short weekday name for a date (e.g. "Mon" / "E").
 */
export function formatDayShort(
  date: Date,
  locale: Locale,
  options: DateFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    timeZone: options.timeZone,
  }).format(date)
}

/**
 * Format the long weekday name for a date (e.g. "Monday" / "esmaspäev").
 */
export function formatDayLong(date: Date, locale: Locale, options: DateFormatOptions = {}): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    timeZone: options.timeZone,
  }).format(date)
}

/**
 * Format a date for compact display, combining the short weekday and an
 * absolute month-day (e.g. "Mon 5 Apr" / "E 5. apr"). Used in timeline rows.
 */
export function formatDateDisplay(
  date: Date,
  locale: Locale,
  options: DateFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: options.timeZone,
  }).format(date)
}

interface RelativeDateOptions extends DateFormatOptions {
  /**
   * Reference date for the "today" comparison. Defaults to `new Date()`.
   * Useful in tests; in production the caller usually omits it.
   */
  referenceDate?: Date
}

/**
 * Locale-aware relative-date label. Returns one of:
 *   - "Today" / "Täna" (same calendar day as `referenceDate`)
 *   - "Tomorrow" / "Homme" (next day)
 *   - localized weekday name (within 7 days)
 *   - "In N days" / "N päeva pärast" (more than 7 days ahead, ICU plural)
 *   - "Past" / "Möödas" (date in the past)
 *
 * The translator must be scoped to the `dates` namespace so calls like
 * `t('today')` and `t('inDays', { count })` resolve correctly.
 */
export function formatRelativeDate(
  date: Date,
  locale: Locale,
  t: DatesTranslator,
  options: RelativeDateOptions = {},
): string {
  const reference = options.referenceDate ?? new Date()

  const referenceMidnight = new Date(reference)
  referenceMidnight.setHours(0, 0, 0, 0)

  const targetMidnight = new Date(date)
  targetMidnight.setHours(0, 0, 0, 0)

  const diffMs = targetMidnight.getTime() - referenceMidnight.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return t('today')
  if (diffDays === 1) return t('tomorrow')
  if (diffDays > 1 && diffDays <= 7) {
    return formatDayLong(date, locale, { timeZone: options.timeZone })
  }
  if (diffDays > 7) return t('inDays', { count: diffDays })
  return t('past')
}
