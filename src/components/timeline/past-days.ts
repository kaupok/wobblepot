import { parseLocalDate } from '@/lib/meal-planning/dates'
import { formatAbsoluteDate, formatDayLong } from '@/lib/i18n/format-dates'
import type { Locale } from '@/lib/i18n/locales'
import type { PlanEntry, TimelineDay } from '@/components/meal-plan/types'

const mealTypeOrder: Record<string, number> = { breakfast: 0, lunch: 1, dinner: 2 }

/**
 * Past entries that still need action: before today, still `planned`, and with
 * a meal. Marking one cooked runs the pantry deduction and the rating prompt,
 * so this is the count the notice on Today asks the household to clear.
 */
export function countPastCatchUp(entries: PlanEntry[], todayDate: string): number {
  return entries.filter((e) => e.date < todayDate && e.status === 'planned' && e.meal).length
}

/**
 * The past days that have entries, newest first: yesterday leads because it is
 * the day most likely to still need marking. Entries before `todayDate` only;
 * the caller decides how far back to load.
 */
export function buildPastDays(
  entries: PlanEntry[],
  todayDate: string,
  locale: Locale,
): TimelineDay[] {
  const entriesByDate = new Map<string, PlanEntry[]>()
  for (const entry of entries) {
    if (entry.date >= todayDate) continue
    const existing = entriesByDate.get(entry.date) ?? []
    existing.push(entry)
    entriesByDate.set(entry.date, existing)
  }

  return [...entriesByDate.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((dateStr) => {
      const date = parseLocalDate(dateStr)
      return {
        date: dateStr,
        // The weekday is the name; the date is a detail, so the card dims it.
        label: formatDayLong(date, locale),
        dateLabel: formatAbsoluteDate(date, locale),
        isToday: false,
        isTomorrow: false,
        isPast: true,
        entries: (entriesByDate.get(dateStr) ?? []).sort(
          (a, b) => (mealTypeOrder[a.mealType] ?? 3) - (mealTypeOrder[b.mealType] ?? 3),
        ),
        emptySlots: [],
      }
    })
}
