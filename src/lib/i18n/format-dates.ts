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

interface DateRangeFormatOptions extends DateFormatOptions {
  /**
   * When `true`, include the year in the formatted output. Cross-year ranges
   * always include the year regardless of this flag (ICU adds it because the
   * range would otherwise be ambiguous). Defaults to `false`.
   */
  withYear?: boolean
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
 *
 * Pass `withYear: true` when callers want the year on same-year ranges.
 * Cross-year ranges always include the year (ICU forces it to disambiguate),
 * so callers must NOT manually append the year — that produces duplicate-year
 * output like `"Dec 29, 2025 – Jan 4, 2026, 2026"`.
 */
export function formatDateRange(
  start: Date,
  end: Date,
  locale: Locale,
  options: DateRangeFormatOptions = {},
): string {
  const formatter = new Intl.DateTimeFormat(locale, {
    year: options.withYear ? 'numeric' : undefined,
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

/**
 * Format a full, long-form date: weekday, day, month, and year (e.g.
 * "Monday, April 5, 2026" / "esmaspäev, 5. aprill 2026"). Used where a date
 * needs to read unambiguously on its own, such as an invite-expiry line.
 */
export function formatFullDate(
  date: Date,
  locale: Locale,
  options: DateFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: options.timeZone,
  }).format(date)
}

/**
 * Format a date together with the time of day (e.g. "Apr 5, 2026, 2:30 PM" /
 * "5. apr 2026, 14:30"). Hour convention (12h vs 24h) follows the locale.
 * Used for audit-style timestamps; callers that want a fixed language (e.g.
 * the English-only admin tooling) pass `DEFAULT_LOCALE` explicitly so the
 * output never depends on the runtime's ambient locale.
 */
export function formatDateTime(
  date: Date,
  locale: Locale,
  options: DateFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
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
 * When `timeZone` is supplied, the calendar-day comparison uses that timezone
 * (not the runtime's local timezone) so a household in `Europe/Tallinn` at
 * 23:30 local sees the right label even when the server clock is elsewhere.
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
  const diffDays = calendarDaysBetween(reference, date, options.timeZone)

  if (diffDays === 0) return t('today')
  if (diffDays === 1) return t('tomorrow')
  if (diffDays > 1 && diffDays <= 7) {
    return formatDayLong(date, locale, { timeZone: options.timeZone })
  }
  if (diffDays > 7) return t('inDays', { count: diffDays })
  return t('past')
}

/**
 * Difference in calendar days from `from` to `to`, evaluated in the given
 * timezone (or runtime-local when `timeZone` is undefined). Uses `en-CA` (the
 * only Intl locale that emits ISO YYYY-MM-DD) to extract calendar days, then
 * subtracts using local-midnight `Date` math — no DST drift, no
 * runtime-local-vs-`timeZone` skew.
 */
function calendarDaysBetween(from: Date, to: Date, timeZone?: string): number {
  const fromDay = parseISODay(toCalendarDay(from, timeZone))
  const toDay = parseISODay(toCalendarDay(to, timeZone))
  const diffMs = toDay.getTime() - fromDay.getTime()
  return Math.round(diffMs / (1000 * 60 * 60 * 24))
}

function toCalendarDay(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function parseISODay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y as number, (m as number) - 1, d as number)
}
