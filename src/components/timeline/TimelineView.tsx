'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { TimelineDayCard } from './TimelineDayCard'
import { TimelinePastSection } from './TimelinePastSection'
import { FillDaysAction } from './FillDaysAction'
import { UrgentShopping } from './UrgentShopping'
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

  const { pastDays, futureDays, firstEmptyDate } = useMemo(() => {
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
    let firstEmpty: string | null = null

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

      // Track first empty future date
      if (!isPast && emptySlots.length > 0 && !firstEmpty) {
        firstEmpty = dateStr
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

    return { pastDays: past, futureDays: future, firstEmptyDate: firstEmpty }
  }, [entries, todayDate, expectedMealTypes, locale, tDates])

  function handleEntryUpdated() {
    router.refresh()
  }

  const hasEmptyFutureSlots = futureDays.some((d) => d.emptySlots.length > 0)

  // Split future days at the first empty date boundary
  const plannedDays = firstEmptyDate
    ? futureDays.filter((d) => d.date < firstEmptyDate)
    : futureDays
  const emptyDays = firstEmptyDate ? futureDays.filter((d) => d.date >= firstEmptyDate) : []

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left column: Timeline */}
        <div className="flex flex-col gap-6">
          <TimelinePastSection
            days={pastDays}
            planId={planId}
            householdSize={householdSize}
            pantryIngredients={pantryIngredients}
            pantryItems={pantryItems}
            onEntryUpdated={handleEntryUpdated}
          />

          {plannedDays.map((day) => (
            <TimelineDayCard
              key={day.date}
              day={day}
              planId={planId}
              householdSize={householdSize}
              pantryIngredients={pantryIngredients}
              pantryItems={pantryItems}
              onEntryUpdated={handleEntryUpdated}
            />
          ))}

          {hasEmptyFutureSlots && firstEmptyDate && (
            <FillDaysAction planId={planId} firstEmptyDate={firstEmptyDate} />
          )}

          {emptyDays.map((day) => (
            <TimelineDayCard
              key={day.date}
              day={day}
              planId={planId}
              householdSize={householdSize}
              pantryIngredients={pantryIngredients}
              pantryItems={pantryItems}
              onEntryUpdated={handleEntryUpdated}
            />
          ))}
        </div>

        {/* Right column: Shopping */}
        <div className="flex flex-col gap-6">
          <UrgentShopping items={shoppingItems} />
        </div>
      </div>
    </div>
  )
}
