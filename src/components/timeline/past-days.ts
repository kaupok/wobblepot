import { parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { formatAbsoluteDate, formatDayLong } from '@/lib/i18n/format-dates'
import type { Locale } from '@/lib/i18n/locales'
import type { ExpectedMealTypes, PlanEntry, TimelineDay } from '@/components/meal-plan/types'
import { daySlots } from './day-slots'

interface PastDaysRange {
  /** The first day, `YYYY-MM-DD`, inclusive. */
  startDate: string
  /** The household's today, `YYYY-MM-DD`: the range ends the day before. */
  todayDate: string
  expectedMealTypes: ExpectedMealTypes
  locale: Locale
}

/**
 * Every past day in `[startDate, todayDate)`, newest first: yesterday leads
 * because it is the day most likely to still need marking. A day lists its
 * recipe and fridge meals as rows and its expected meal types with no entry
 * as empty slots, where the household logs what it ate (HON-1383). A day
 * with neither is left out. A note-only entry fills its slot, as on Today,
 * but is no row: it has nothing to mark.
 */
export function buildPastDays(
  entries: PlanEntry[],
  { startDate, todayDate, expectedMealTypes, locale }: PastDaysRange,
): TimelineDay[] {
  const entriesByDate = new Map<string, PlanEntry[]>()
  for (const entry of entries) {
    const existing = entriesByDate.get(entry.date) ?? []
    existing.push(entry)
    entriesByDate.set(entry.date, existing)
  }

  const days: TimelineDay[] = []
  const first = parseLocalDate(startDate)
  const current = parseLocalDate(todayDate)
  current.setDate(current.getDate() - 1)
  for (; current >= first; current.setDate(current.getDate() - 1)) {
    const dateStr = toDateString(current)
    const slots = daySlots(current, entriesByDate.get(dateStr) ?? [], expectedMealTypes)
    const rows = slots.entries.filter((e) => e.meal !== null || e.kind === 'fridge')
    if (rows.length === 0 && slots.emptySlots.length === 0) continue
    days.push({
      date: dateStr,
      // The weekday is the name; the date is a detail, so the card dims it.
      label: formatDayLong(current, locale),
      dateLabel: formatAbsoluteDate(current, locale),
      isToday: false,
      isTomorrow: false,
      entries: rows,
      emptySlots: slots.emptySlots,
      // Past meals show no extras: an extra is for a day still to come (HON-1309).
      extras: [],
    })
  }
  return days
}
