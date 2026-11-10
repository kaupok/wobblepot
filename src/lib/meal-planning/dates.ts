/**
 * Date utilities for meal planning.
 * All dates are handled as local midnight to avoid timezone shift issues.
 *
 * Display-side date / time formatting (with locale + timezone) lives in
 * `src/lib/i18n/format-dates.ts`. This module is intentionally locale-agnostic —
 * it deals in `Date` objects and YYYY-MM-DD strings only.
 */

/**
 * Format a date as YYYY-MM-DD string in local time.
 * Avoids UTC timezone shift issues.
 */
export function toDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Parse a YYYY-MM-DD string as local midnight Date.
 * Avoids UTC timezone shift issues that occur with new Date(string).
 * @throws {Error} If dateString is not in valid YYYY-MM-DD format
 */
export function parseLocalDate(dateString: string): Date {
  const parts = dateString.split('-')
  if (parts.length !== 3) {
    throw new Error(`Invalid date format: "${dateString}". Expected YYYY-MM-DD`)
  }
  const [yearStr, monthStr, dayStr] = parts
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    throw new Error(`Invalid date format: "${dateString}". Expected YYYY-MM-DD`)
  }
  return new Date(year, month - 1, day)
}

/**
 * Check if a date is a weekday (Monday-Friday).
 */
export function isWeekday(date: Date): boolean {
  const day = date.getDay()
  return day >= 1 && day <= 5
}

/**
 * Get the current date as YYYY-MM-DD string in the specified timezone.
 * Used for "today" highlighting when the household timezone differs from browser timezone.
 *
 * The `'en-CA'` argument is a parser-format selector — `en-CA` is the only
 * Intl locale that emits ISO `YYYY-MM-DD` from `Intl.DateTimeFormat` with these
 * options. The output is never shown to the user, so this string is
 * intentionally locale-agnostic.
 *
 * @param now - the instant to read the date of; tests and the reminder cron pass it
 */
export function getTodayInTimezone(timezone: string, now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(now)
}

/**
 * Get the current hour (0-23) in the specified timezone.
 *
 * @param now - the instant to read the hour of; tests pass it
 */
export function getHourInTimezone(timezone: string, now: Date = new Date()): number {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: 'numeric',
    hourCycle: 'h23',
  })
  return Number(formatter.format(now))
}

/**
 * Get the start of today (midnight) as a Date in the specified timezone.
 * Returns a Date object that represents midnight in the given timezone,
 * suitable for database date comparisons.
 *
 * @param timezone - IANA timezone string (e.g., 'Europe/Tallinn')
 */
export function getStartOfTodayInTimezone(timezone: string): Date {
  const todayString = getTodayInTimezone(timezone)
  return parseLocalDate(todayString)
}

/**
 * Get an array of dates between startDate and endDate (inclusive of start, exclusive of end).
 * Used for flexible date range generation.
 */
export function getDatesBetween(startDate: Date, endDate: Date): Date[] {
  const dates: Date[] = []
  const current = new Date(startDate)
  current.setHours(0, 0, 0, 0)
  const end = new Date(endDate)
  end.setHours(0, 0, 0, 0)

  while (current < end) {
    dates.push(new Date(current))
    current.setDate(current.getDate() + 1)
  }

  return dates
}

export type UrgencyBucket = 'today' | 'tomorrow' | 'this-week' | 'later'

/**
 * Determine the urgency bucket for a given date string.
 * Used for grouping shopping list items by urgency.
 *
 * @param dateString - The date in YYYY-MM-DD format
 * @param referenceDate - The date to compare against (defaults to today)
 * @returns The urgency bucket: 'today', 'tomorrow', 'this-week', or 'later'
 */
export function getUrgencyBucket(dateString: string, referenceDate?: Date): UrgencyBucket {
  const today = referenceDate ?? new Date()
  today.setHours(0, 0, 0, 0)

  const target = parseLocalDate(dateString)

  const diffMs = target.getTime() - today.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays <= 0) {
    return 'today'
  }
  if (diffDays === 1) {
    return 'tomorrow'
  }

  // Calculate days until end of week (Sunday)
  const dayOfWeek = today.getDay()
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek

  if (diffDays <= daysUntilSunday) {
    return 'this-week'
  }

  return 'later'
}
