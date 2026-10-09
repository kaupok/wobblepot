'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { TimelineDayCard } from './TimelineDayCard'
import { FillDaysAction } from './FillDaysAction'
import { UrgentShopping } from './UrgentShopping'
import { Heading } from '@/components/ui/typography'
import { parseLocalDate, toDateString, isWeekday } from '@/lib/meal-planning/dates'
import { formatAbsoluteDate, formatDayLong } from '@/lib/i18n/format-dates'
import type { Locale } from '@/lib/i18n/locales'
import type {
  PlanEntry,
  PantryIngredient,
  PantryItemFull,
  ExpectedMealTypes,
  TimelineDay,
} from '@/components/meal-plan/types'
import type { MealType } from '@/generated/prisma/enums'
import type { UrgencyBucket } from '@/lib/meal-planning/dates'

interface ShoppingItem {
  ingredientId: string
  name: string
  displayQuantity: string
  neededByDate: string
  neededByRelative: string
  purchased: boolean
  urgency: UrgencyBucket
}

interface TimelineViewProps {
  entries: PlanEntry[]
  planId: string
  expectedMealTypes: ExpectedMealTypes
  householdServings: number
  pantryIngredients: PantryIngredient[]
  pantryItems: PantryItemFull[]
  shoppingItems: ShoppingItem[]
  /** Unchecked custom items on the list: they carry no date, so they are not in `shoppingItems`. */
  openCustomItemCount?: number
  todayDate: string // YYYY-MM-DD
}

const mealTypeOrder: Record<string, number> = { breakfast: 0, lunch: 1, dinner: 2 }

function getDayLabel(
  dateStr: string,
  todayStr: string,
  tomorrowStr: string,
  locale: Locale,
  todayLabel: string,
  tomorrowLabel: string,
): { label: string; dateLabel?: string; isToday: boolean; isTomorrow: boolean } {
  if (dateStr === todayStr) {
    return { label: todayLabel, isToday: true, isTomorrow: false }
  }
  if (dateStr === tomorrowStr) {
    return { label: tomorrowLabel, isToday: false, isTomorrow: true }
  }
  const date = parseLocalDate(dateStr)
  // The weekday is the name; the date is a detail, so the card dims it.
  return {
    label: formatDayLong(date, locale),
    dateLabel: formatAbsoluteDate(date, locale),
    isToday: false,
    isTomorrow: false,
  }
}

export function TimelineView({
  entries,
  planId,
  expectedMealTypes,
  householdServings,
  pantryIngredients,
  pantryItems,
  shoppingItems,
  openCustomItemCount = 0,
  todayDate,
}: TimelineViewProps) {
  const router = useRouter()
  const locale = useLocale() as Locale
  const tDates = useTranslations('dates')
  const tToday = useTranslations('today')

  const { futureDays, fillStartDate } = useMemo(() => {
    const todayParsed = parseLocalDate(todayDate)
    const tomorrowParsed = new Date(todayParsed)
    tomorrowParsed.setDate(tomorrowParsed.getDate() + 1)
    const tomorrowDate = toDateString(tomorrowParsed)

    // Build date range: today to +14. Past days have their own page
    // (`/past-meals`, HON-1007), and the account menu's dot says when some
    // are still to mark (HON-1028).
    const endParsed = new Date(todayParsed)
    endParsed.setDate(endParsed.getDate() + 14)

    // Group entries by date
    const entriesByDate = new Map<string, PlanEntry[]>()
    for (const entry of entries) {
      const existing = entriesByDate.get(entry.date) ?? []
      existing.push(entry)
      entriesByDate.set(entry.date, existing)
    }

    // Build timeline days
    const days: TimelineDay[] = []
    const current = new Date(todayParsed)
    // Filling starts on the first future day with nothing planned, so the fill
    // bar sits where the planned run from today ends and its range matches its
    // position. Gaps inside that run (an empty breakfast on a day with a
    // dinner) are filled per slot, not by the bar (HON-758). Anchoring on the
    // first unplanned day rather than after the last planned one keeps a
    // single far-future entry from hiding the bar above a run of empty days.
    // Null when every day in the window has an entry.
    let fillStart: string | null = null

    while (current <= endParsed) {
      const dateStr = toDateString(current)
      const { label, dateLabel, isToday, isTomorrow } = getDayLabel(
        dateStr,
        todayDate,
        tomorrowDate,
        locale,
        tDates('today'),
        tDates('tomorrow'),
      )

      // Get expected meal types for this day
      const expectedTypes: MealType[] = isWeekday(current)
        ? expectedMealTypes.weekdayMealTypes
        : expectedMealTypes.weekendMealTypes

      // Get existing entries for this day
      const dayEntries = (entriesByDate.get(dateStr) ?? []).sort(
        (a, b) => (mealTypeOrder[a.mealType] ?? 3) - (mealTypeOrder[b.mealType] ?? 3),
      )

      // Compute empty slots (expected types without existing entries)
      const existingTypes = new Set(dayEntries.map((e) => e.mealType))
      const emptySlots = expectedTypes.filter((mt) => !existingTypes.has(mt))

      if (dayEntries.length === 0 && fillStart === null) {
        fillStart = dateStr
      }

      days.push({
        date: dateStr,
        label,
        dateLabel,
        isToday,
        isTomorrow,
        entries: dayEntries,
        emptySlots,
      })

      current.setDate(current.getDate() + 1)
    }

    return { futureDays: days, fillStartDate: fillStart }
  }, [entries, todayDate, expectedMealTypes, locale, tDates])

  function handleEntryUpdated() {
    router.refresh()
  }

  // A cleared card unmounts and takes focus with it, so its empty slot takes
  // focus as it renders (HON-1123). Held here, by date, because clearing a
  // day's last meal can move the day from the planned run to the empty days,
  // which remounts its `TimelineDayCard`.
  const [slotToFocus, setSlotToFocus] = useState<{ date: string; mealType: MealType } | null>(null)
  const handleSlotFocused = useCallback(() => setSlotToFocus(null), [])

  const hasEmptyFutureSlots = futureDays.some((d) => d.emptySlots.length > 0)

  // Split future days at the fill boundary
  const plannedDays = fillStartDate ? futureDays.filter((d) => d.date < fillStartDate) : futureDays
  const emptyDays = fillStartDate ? futureDays.filter((d) => d.date >= fillStartDate) : []

  function renderDay(day: TimelineDay) {
    return (
      <TimelineDayCard
        key={day.date}
        day={day}
        planId={planId}
        householdServings={householdServings}
        pantryIngredients={pantryIngredients}
        pantryItems={pantryItems}
        onEntryUpdated={handleEntryUpdated}
        onEntryCleared={setSlotToFocus}
        focusSlot={slotToFocus?.date === day.date ? slotToFocus.mealType : undefined}
        onSlotFocused={handleSlotFocused}
      />
    )
  }

  return (
    <div className="w-full px-4 py-8">
      {/* A workspace page titles its sections, not the page, so the page's one
          h1 is for the outline only (docs/DESIGN.md → Composition rules). Not
          "Today": the first day card is already headed that (HON-815). */}
      <div className="sr-only">
        <Heading variant="h4" as="h1">
          {tToday('pageTitle')}
        </Heading>
      </div>
      <div className="lg:grid-cols-timeline grid gap-8">
        {/* Left column: Timeline. `gap-8` between days, wider than the `gap-2`
            between one day's cards, so the days read as groups. */}
        <div className="flex flex-col gap-8">
          {/* Below lg the right column falls under 14 days of cards, so the
              phone gets the summary here instead (HON-766). Both forms are in
              the server HTML and CSS picks one: no viewport state, and
              display:none keeps the hidden copy out of the a11y tree. `empty:hidden`
              drops the wrapper's gap when there is nothing to buy. */}
          <div className="empty:hidden lg:hidden">
            <UrgentShopping items={shoppingItems} todayDate={todayDate} compact />
          </div>

          {plannedDays.map(renderDay)}

          {hasEmptyFutureSlots && fillStartDate && (
            <FillDaysAction planId={planId} startDate={fillStartDate} />
          )}

          {emptyDays.map(renderDay)}
        </div>

        {/* Right column: Shopping */}
        <div className="hidden flex-col gap-6 lg:flex">
          <UrgentShopping
            items={shoppingItems}
            openCustomItemCount={openCustomItemCount}
            todayDate={todayDate}
          />
        </div>
      </div>
    </div>
  )
}
