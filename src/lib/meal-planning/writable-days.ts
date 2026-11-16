import { getTodayInTimezone, parseLocalDate, toDateString } from './dates'

/** How far ahead `plan_meal`, `add_extra` and `apply_plan` may write, in days after today. */
export const MAX_DAYS_AHEAD = 28

/** Today and the last day a tool may write to, YYYY-MM-DD in the household's timezone. */
export function writableDays(timezone: string): { today: string; lastDay: string } {
  const today = getTodayInTimezone(timezone)
  const lastDay = parseLocalDate(today)
  lastDay.setDate(lastDay.getDate() + MAX_DAYS_AHEAD)
  return { today, lastDay: toDateString(lastDay) }
}
