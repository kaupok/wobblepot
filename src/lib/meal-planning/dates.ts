/**
 * Date utilities for meal planning.
 * All dates are handled as local midnight to avoid timezone shift issues.
 *
 * Display-side date / time formatting (with locale + timezone) lives in
 * `src/lib/i18n/format-dates.ts`. This module is intentionally locale-agnostic —
 * it deals in `Date` objects and YYYY-MM-DD strings only.
 */

/**
 * Get the next Monday from today.
 * If today is Monday, returns next week's Monday.
 */
export function getNextMonday(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dayOfWeek = today.getDay()
  // Sunday = 0, Monday = 1, ..., Saturday = 6
  // If today is Sunday (0), next Monday is 1 day away
  // If today is Monday (1), next Monday is 7 days away
  // If today is Tuesday (2), next Monday is 6 days away
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek
  today.setDate(today.getDate() + daysUntilMonday)
  return today
}

/**
 * Get an array of 7 consecutive dates starting from the given date.
 */
export function getWeekDates(startDate: Date): Date[] {
  const dates: Date[] = []
  for (let i = 0; i < 7; i++) {
    const date = new Date(startDate)
    date.setDate(startDate.getDate() + i)
    dates.push(date)
  }
  return dates
}

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
 * Check if a date is a Monday.
 */
export function isMonday(date: Date): boolean {
  return date.getDay() === 1
}

/**
 * Check if a date is a weekday (Monday-Friday).
 */
export function isWeekday(date: Date): boolean {
  const day = date.getDay()
  return day >= 1 && day <= 5
}

/**
 * Get Monday of the previous week.
 * Returns the Monday 7 days before the current week's Monday.
 */
export function getLastWeekMonday(): Date {
  const currentMonday = getCurrentWeekMonday()
  currentMonday.setDate(currentMonday.getDate() - 7)
  return currentMonday
}

/**
 * Get Monday of the current week.
 * If today is Sunday, returns the Monday that just passed (start of this week).
 * If today is Monday, returns today.
 */
export function getCurrentWeekMonday(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dayOfWeek = today.getDay()
  // Sunday = 0, Monday = 1, ..., Saturday = 6
  // If Sunday (0), Monday was 6 days ago
  // If Monday (1), Monday is today (0 days ago)
  // If Tuesday (2), Monday was 1 day ago
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  today.setDate(today.getDate() - daysSinceMonday)
  return today
}

/**
 * Check if a date is a Sunday.
 */
export function isSunday(date?: Date): boolean {
  const d = date ?? new Date()
  return d.getDay() === 0
}

/**
 * Get the number of days remaining in the current week, including today.
 * Sunday = 1 (only Sunday left), Monday = 7 (full week), Saturday = 2, etc.
 *
 * @param timezone - Optional IANA timezone string (e.g., 'Europe/Tallinn').
 *                   If provided, calculates based on today in that timezone.
 *                   If omitted, uses server/local time.
 */
export function getDaysRemaining(timezone?: string): number {
  let dayOfWeek: number
  if (timezone) {
    // Get today's date string in the specified timezone, then parse it
    const todayString = getTodayInTimezone(timezone)
    const todayDate = parseLocalDate(todayString)
    dayOfWeek = todayDate.getDay()
  } else {
    const today = new Date()
    dayOfWeek = today.getDay()
  }
  // Sunday = 0 -> 1 day remaining (just Sunday)
  // Monday = 1 -> 7 days remaining
  // Tuesday = 2 -> 6 days remaining
  // Saturday = 6 -> 2 days remaining
  return dayOfWeek === 0 ? 1 : 8 - dayOfWeek
}

/**
 * Get the current date as YYYY-MM-DD string in the specified timezone.
 * Used for "today" highlighting when the household timezone differs from browser timezone.
 *
 * The `'en-CA'` argument is a parser-format selector — `en-CA` is the only
 * Intl locale that emits ISO `YYYY-MM-DD` from `Intl.DateTimeFormat` with these
 * options. The output is never shown to the user, so this string is
 * intentionally locale-agnostic.
 */
export function getTodayInTimezone(timezone: string): string {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(now)
}

/**
 * Get dates from a start date through the end of that week (Sunday).
 * Used for partial week planning when user signs up mid-week.
 */
export function getRemainingWeekDates(startDate: Date): Date[] {
  const dates: Date[] = []
  const start = new Date(startDate)
  start.setHours(0, 0, 0, 0)

  // Find the Sunday that ends this week
  const dayOfWeek = start.getDay()
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek

  for (let i = 0; i <= daysUntilSunday; i++) {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    dates.push(date)
  }

  return dates
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
 * Get the Monday of the week that contains the given date.
 * Mon-Sun week: Monday = start, Sunday = end.
 */
export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const dayOfWeek = d.getDay()
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  d.setDate(d.getDate() - daysSinceMonday)
  return d
}

/**
 * Get an array of consecutive dates starting from the given date.
 */
export function getDateRange(startDate: Date, days: number): Date[] {
  const dates: Date[] = []
  for (let i = 0; i < days; i++) {
    const date = new Date(startDate)
    date.setDate(startDate.getDate() + i)
    dates.push(date)
  }
  return dates
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

/**
 * Meal time window cutoffs in hours (24-hour format).
 * After these times, we prompt users if they made the meal.
 */
export const MEAL_TIME_CUTOFFS = {
  breakfast: 10, // 10:00 AM
  lunch: 14, // 2:00 PM
  dinner: 20, // 8:00 PM
} as const

export type MealType = keyof typeof MEAL_TIME_CUTOFFS

/**
 * Check if a meal's time window has passed for today.
 * Used to determine when to show the "Did you make it?" prompt.
 *
 * The `'en-US'` argument is a parser-format selector — only the numeric hour
 * digit is read from `formatter.format(now)` and compared to a constant. The
 * output is never shown to the user, so this string is intentionally
 * locale-agnostic.
 *
 * @param mealType - The type of meal (breakfast, lunch, dinner)
 * @param timezone - IANA timezone string (e.g., 'Europe/Tallinn')
 * @returns true if the meal's time window has passed
 */
export function hasMealTimePassed(mealType: MealType, timezone: string): boolean {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  })
  const currentHour = parseInt(formatter.format(now), 10)
  return currentHour >= MEAL_TIME_CUTOFFS[mealType]
}
