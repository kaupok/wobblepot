'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { TimelineDayCard } from './TimelineDayCard'
import { buildPastDays } from './past-days'
import type { Locale } from '@/lib/i18n/locales'
import type { PlanEntry, PantryIngredient, PantryItemFull } from '@/components/meal-plan/types'

interface PastMealsListProps {
  entries: PlanEntry[]
  planId: string
  householdSize: number
  pantryIngredients: PantryIngredient[]
  pantryItems: PantryItemFull[]
  todayDate: string // YYYY-MM-DD
}

/**
 * The past days on `/past-meals`, newest first. Each day is a
 * `TimelineDayCard`, so the status select, the pantry deduction and the rating
 * prompt work as they do on Today (HON-1007).
 */
export function PastMealsList({
  entries,
  planId,
  householdSize,
  pantryIngredients,
  pantryItems,
  todayDate,
}: PastMealsListProps) {
  const router = useRouter()
  const locale = useLocale() as Locale
  const days = useMemo(
    () => buildPastDays(entries, todayDate, locale),
    [entries, todayDate, locale],
  )

  // `gap-8` between days, as on Today, so the days read as groups.
  return (
    <div className="flex flex-col gap-8">
      {days.map((day) => (
        <TimelineDayCard
          key={day.date}
          day={day}
          planId={planId}
          householdSize={householdSize}
          pantryIngredients={pantryIngredients}
          pantryItems={pantryItems}
          onEntryUpdated={() => router.refresh()}
        />
      ))}
    </div>
  )
}
