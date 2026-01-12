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
