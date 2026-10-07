import { parseLocalDate } from '@/lib/meal-planning/dates'

/**
 * The weekly planning reminder's calendar (HON-1084), shared by the settings
 * section, the routes and the cron. No server imports, so the client can use
 * the weekday list.
 */

/** ISO weekdays: 1 is Monday, 7 is Sunday. */
export const REMINDER_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const

export type ReminderWeekday = (typeof REMINDER_WEEKDAYS)[number]

/** The day a newly switched-on reminder goes out: Sunday. */
export const DEFAULT_REMINDER_WEEKDAY: ReminderWeekday = 7

/** The ISO weekday of a `YYYY-MM-DD` date: 1 is Monday, 7 is Sunday. */
export function isoWeekday(dateString: string): ReminderWeekday {
  const day = parseLocalDate(dateString).getDay()
  return (day === 0 ? 7 : day) as ReminderWeekday
}

/**
 * Next week for a household whose date is `today` (`YYYY-MM-DD`): the Monday
 * after today, through its Sunday. On a Sunday it starts tomorrow; on a Monday
 * it starts in seven days. `end` is the Monday after, exclusive.
 *
 * Both bounds are `parseLocalDate` midnights, the form meal plan entries store
 * their `date` in, so a range query compares them as `toDateString` does.
 */
export function nextWeekRange(today: string): { start: Date; end: Date } {
  const start = parseLocalDate(today)
  start.setDate(start.getDate() + 8 - isoWeekday(today))
  const end = new Date(start)
  end.setDate(start.getDate() + 7)
  return { start, end }
}
