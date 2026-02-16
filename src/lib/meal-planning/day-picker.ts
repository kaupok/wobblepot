import { toDateString, getNextMonday, formatDayMonth, formatDayShort } from './dates'

export interface DayOption {
  label: string
  date: string
}

/**
 * Generate day picker options for the first-time meal plan generation screen.
 *
 * Options:
 * - Today (always shown)
 * - Tomorrow (shown if today is not Saturday)
 * - Named weekdays with dates (remaining days of the week after tomorrow)
 * - Next week (always shown, points to next Monday)
 *
 * @param today - Override for testability (defaults to current date)
 */
export function getDayPickerOptions(today?: Date): DayOption[] {
  const d = today ? new Date(today) : new Date()
  d.setHours(0, 0, 0, 0)
  const dayOfWeek = d.getDay() // 0=Sun, 1=Mon, ..., 6=Sat
  const options: DayOption[] = []

  // Today (always)
  options.push({ label: 'Today', date: toDateString(d) })

  // Days remaining in the current week after today (Mon-Sun week)
  // Sunday=0 → 0, Monday=1 → 6, Tuesday=2 → 5, ..., Saturday=6 → 1
  const daysRemaining = dayOfWeek === 0 ? 0 : 7 - dayOfWeek

  // Tomorrow (if today is not Saturday — on Saturday, tomorrow is Sunday which is end-of-week)
  if (dayOfWeek !== 6 && daysRemaining >= 1) {
    const tomorrow = new Date(d)
    tomorrow.setDate(d.getDate() + 1)
    options.push({ label: 'Tomorrow', date: toDateString(tomorrow) })
  }

  // Named weekdays: 2+ days from now, within current week (up to Sunday)
  for (let offset = 2; offset <= daysRemaining; offset++) {
    const date = new Date(d)
    date.setDate(d.getDate() + offset)
    options.push({
      label: `${formatDayShort(date)} (${formatDayMonth(date)})`,
      date: toDateString(date),
    })
  }

  // Next week (always)
  const nextMon = getNextMonday()
  options.push({
    label: `Next week (${formatDayMonth(nextMon)})`,
    date: toDateString(nextMon),
  })

  return options
}
