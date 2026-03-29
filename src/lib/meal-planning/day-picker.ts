import { toDateString, formatDayMonth, formatDayShort } from './dates'

export interface DayOption {
  label: string
  date: string
}

export interface DaysCountOption {
  value: number
  label: string
}

/**
 * Generate start-date options for the first-time meal plan generation screen.
 *
 * Options:
 * - Today (always shown)
 * - Tomorrow (shown if today is not Saturday)
 * - Named weekdays with dates (remaining days of the week after tomorrow, up to 5 total)
 *
 * @param today - Override for testability (defaults to current date)
 */
export function getStartDateOptions(today?: Date): DayOption[] {
  const d = today ? new Date(today) : new Date()
  d.setHours(0, 0, 0, 0)
  const options: DayOption[] = []

  // Today (always shown)
  options.push({ label: 'Today', date: toDateString(d) })

  // Tomorrow
  const tomorrow = new Date(d)
  tomorrow.setDate(d.getDate() + 1)
  options.push({ label: 'Tomorrow', date: toDateString(tomorrow) })

  // Next few days (up to 5 options total)
  for (let offset = 2; offset <= 4; offset++) {
    const date = new Date(d)
    date.setDate(d.getDate() + offset)
    options.push({
      label: `${formatDayShort(date)} (${formatDayMonth(date)})`,
      date: toDateString(date),
    })
  }

  return options
}

/**
 * Generate days-count options for flexible date range selection.
 * Returns options for how many days to generate a plan for.
 */
export function getDaysCountOptions(): DaysCountOption[] {
  return [
    { value: 3, label: '3 days' },
    { value: 5, label: '5 days' },
    { value: 7, label: '7 days' },
    { value: 10, label: '10 days' },
    { value: 14, label: '14 days' },
  ]
}

/**
 * Compute the end date (exclusive) from a start date string and days count.
 */
export function computeEndDate(startDateStr: string, days: number): string {
  const parts = startDateStr.split('-')
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  const start = new Date(year, month - 1, day)
  start.setDate(start.getDate() + days)
  return toDateString(start)
}
