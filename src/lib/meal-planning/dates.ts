/**
 * Date utilities for meal planning.
 * All dates are handled as local midnight to avoid timezone shift issues.
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
 * Format a date for display (e.g., "Mon 2026-01-12").
 */
export function formatDateDisplay(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `${days[date.getDay()]} ${toDateString(date)}`
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
 */
export function getDaysRemaining(): number {
  const today = new Date()
  const dayOfWeek = today.getDay()
  // Sunday = 0 -> 1 day remaining (just Sunday)
  // Monday = 1 -> 7 days remaining
  // Tuesday = 2 -> 6 days remaining
  // Saturday = 6 -> 2 days remaining
  return dayOfWeek === 0 ? 1 : 8 - dayOfWeek
}

/**
 * Get the current date as YYYY-MM-DD string in the specified timezone.
 * Used for "today" highlighting when the household timezone differs from browser timezone.
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
 * Format a date as a relative string for display in shopping lists.
 * - "Today" if same day
 * - "Tomorrow" if next day
 * - Day name ("Monday", "Tuesday", etc.) if within 7 days
 * - "In X days" if beyond 7 days
 *
 * @param date - The date to format
 * @param referenceDate - The date to compare against (defaults to today)
 */
export function formatRelativeDate(date: Date, referenceDate?: Date): string {
  const today = referenceDate ?? new Date()
  today.setHours(0, 0, 0, 0)

  const target = new Date(date)
  target.setHours(0, 0, 0, 0)

  const diffMs = target.getTime() - today.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return 'Today'
  }
  if (diffDays === 1) {
    return 'Tomorrow'
  }
  if (diffDays > 1 && diffDays <= 7) {
    const days = [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ] as const
    return days[target.getDay()] as string
  }
  if (diffDays > 7) {
    return `In ${diffDays} days`
  }
  // Past dates (shouldn't happen for shopping list but handle gracefully)
  return 'Past'
}

/**
 * Format a date as an absolute short date for tooltips (e.g., "Jan 20").
 *
 * @param date - The date to format
 */
export function formatAbsoluteDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
