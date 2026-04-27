import { toDateString } from './dates'
import { formatDayMonth, formatDayShort, type DatesTranslator } from '@/lib/i18n/format-dates'
import type { Locale } from '@/lib/i18n/locales'

export interface DayOption {
  label: string
  date: string
}

export interface DaysCountOption {
  value: number
  label: string
}

interface StartDateOptionsArgs {
  /** Override "today" for testability. Defaults to `new Date()`. */
  today?: Date
  /** Active locale, used for the named-day labels. */
  locale: Locale
  /** Translator scoped to the `dates` namespace (`today`, `tomorrow`, ...). */
  t: DatesTranslator
}

/**
 * Generate start-date options for the first-time meal plan generation screen.
 *
 * Options:
 * - "Today" / "Täna" (always shown)
 * - "Tomorrow" / "Homme"
 * - Three named days that follow, formatted as `<short weekday> (<day month>)`
 *   in the active locale.
 */
export function getStartDateOptions(args: StartDateOptionsArgs): DayOption[] {
  const { today, locale, t } = args
  const d = today ? new Date(today) : new Date()
  d.setHours(0, 0, 0, 0)
  const options: DayOption[] = []

  options.push({ label: t('today'), date: toDateString(d) })

  const tomorrow = new Date(d)
  tomorrow.setDate(d.getDate() + 1)
  options.push({ label: t('tomorrow'), date: toDateString(tomorrow) })

  for (let offset = 2; offset <= 4; offset++) {
    const date = new Date(d)
    date.setDate(d.getDate() + offset)
    options.push({
      label: `${formatDayShort(date, locale)} (${formatDayMonth(date, locale)})`,
      date: toDateString(date),
    })
  }

  return options
}

/**
 * Generate days-count options for flexible date range selection.
 * Returns options for how many days to generate a plan for. The caller is
 * expected to localize the labels at the render site (currently English-only
 * pending HON-509 — the values are stable and the labels are short).
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
