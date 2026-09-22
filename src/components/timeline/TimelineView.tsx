'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { TimelineDayCard } from './TimelineDayCard'
import { TimelinePastSection, countPastCatchUp } from './TimelinePastSection'
import { TimelinePastMenu } from './TimelinePastMenu'
import { FillDaysAction } from './FillDaysAction'
import { UrgentShopping } from './UrgentShopping'
import { parseLocalDate, toDateString, isWeekday } from '@/lib/meal-planning/dates'
import { prefersReducedMotion } from '@/lib/utils'
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
  householdSize: number
  pantryIngredients: PantryIngredient[]
  pantryItems: PantryItemFull[]
  shoppingItems: ShoppingItem[]
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
): { label: string; isToday: boolean; isTomorrow: boolean } {
  if (dateStr === todayStr) {
    return { label: todayLabel, isToday: true, isTomorrow: false }
  }
  if (dateStr === tomorrowStr) {
    return { label: tomorrowLabel, isToday: false, isTomorrow: true }
  }
  const date = parseLocalDate(dateStr)
  return {
    label: `${formatDayLong(date, locale)} ${formatAbsoluteDate(date, locale)}`,
    isToday: false,
    isTomorrow: false,
  }
}

export function TimelineView({
  entries,
  planId,
  expectedMealTypes,
  householdSize,
  pantryIngredients,
  pantryItems,
  shoppingItems,
  todayDate,
}: TimelineViewProps) {
  const router = useRouter()
  const locale = useLocale() as Locale
  const tDates = useTranslations('dates')
  const [isPastExpanded, setIsPastExpanded] = useState(false)
  const pastSectionRef = useRef<HTMLDivElement>(null)

  // Past days render above Today, so expanding pushes the menu that revealed
  // them down the page. Bring the first past day into view instead.
  useEffect(() => {
    if (!isPastExpanded) return
    pastSectionRef.current?.scrollIntoView({
      block: 'start',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }, [isPastExpanded])

  const { pastDays, futureDays, fillStartDate } = useMemo(() => {
    const todayParsed = parseLocalDate(todayDate)
    const tomorrowParsed = new Date(todayParsed)
    tomorrowParsed.setDate(tomorrowParsed.getDate() + 1)
    const tomorrowDate = toDateString(tomorrowParsed)

    // Build date range: -7 to +14 from today
    const startParsed = new Date(todayParsed)
    startParsed.setDate(startParsed.getDate() - 7)
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
    const allDays: TimelineDay[] = []
    const current = new Date(startParsed)
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
      const isPast = dateStr < todayDate
      const { label, isToday, isTomorrow } = getDayLabel(
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

      if (!isPast && dayEntries.length === 0 && fillStart === null) {
        fillStart = dateStr
      }

      allDays.push({
        date: dateStr,
        label,
        isToday,
        isTomorrow,
        isPast,
        entries: dayEntries,
        emptySlots,
      })

      current.setDate(current.getDate() + 1)
    }

    // Split into past and future (today counts as future)
    const past = allDays.filter((d) => d.isPast && d.entries.length > 0)
    const future = allDays.filter((d) => !d.isPast)

    return { pastDays: past, futureDays: future, fillStartDate: fillStart }
  }, [entries, todayDate, expectedMealTypes, locale, tDates])

  function handleEntryUpdated() {
    router.refresh()
  }

  const hasEmptyFutureSlots = futureDays.some((d) => d.emptySlots.length > 0)

  // Split future days at the fill boundary
  const plannedDays = fillStartDate ? futureDays.filter((d) => d.date < fillStartDate) : futureDays
  const emptyDays = fillStartDate ? futureDays.filter((d) => d.date >= fillStartDate) : []

  // Today can land in either plannedDays or emptyDays, so the menu is attached
  // per card rather than at a fixed position in the list.
  const pastMenu =
    pastDays.length > 0 ? (
      <TimelinePastMenu
        expanded={isPastExpanded}
        catchUpCount={countPastCatchUp(pastDays)}
        onToggle={() => setIsPastExpanded((expanded) => !expanded)}
      />
    ) : null

  function renderDay(day: TimelineDay) {
    return (
      <TimelineDayCard
        key={day.date}
        day={day}
        planId={planId}
        householdSize={householdSize}
        pantryIngredients={pantryIngredients}
        pantryItems={pantryItems}
        onEntryUpdated={handleEntryUpdated}
        headerAction={day.isToday ? pastMenu : undefined}
      />
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="lg:grid-cols-timeline grid gap-6">
        {/* Left column: Timeline */}
        <div className="flex flex-col gap-6">
          <TimelinePastSection
            ref={pastSectionRef}
            days={pastDays}
            expanded={isPastExpanded}
            planId={planId}
            householdSize={householdSize}
            pantryIngredients={pantryIngredients}
            pantryItems={pantryItems}
            onEntryUpdated={handleEntryUpdated}
          />

          {plannedDays.map(renderDay)}

          {hasEmptyFutureSlots && fillStartDate && (
            <FillDaysAction planId={planId} startDate={fillStartDate} />
          )}

          {emptyDays.map(renderDay)}
        </div>

        {/* Right column: Shopping */}
        <div className="flex flex-col gap-6">
          <UrgentShopping items={shoppingItems} />
        </div>
      </div>
    </div>
  )
}
