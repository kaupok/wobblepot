'use client'

import { useMemo } from 'react'
import { useLocale } from 'next-intl'
import { Heading } from '@/components/ui/typography'
import { RowGroup } from '@/components/ui/row-group'
import { PastMealRow } from './PastMealRow'
import { buildPastDays } from './past-days'
import type { Locale } from '@/lib/i18n/locales'
import type { PlanEntry, PantryItemFull } from '@/components/meal-plan/types'

interface PastMealsListProps {
  entries: PlanEntry[]
  planId: string
  householdSize: number
  pantryItems: PantryItemFull[]
  todayDate: string // YYYY-MM-DD
}

/**
 * The past days on `/past-meals`, newest first. Each day is its heading and
 * one `RowGroup` of `PastMealRow`s, breakfast to dinner: the page is a task
 * list, so a meal is a row with one-click Cooked and Skipped, not a Today card
 * (HON-1018). An entry with no meal has nothing to mark, so it has no row, and
 * a day with no rows is left out.
 */
export function PastMealsList({
  entries,
  planId,
  householdSize,
  pantryItems,
  todayDate,
}: PastMealsListProps) {
  const locale = useLocale() as Locale
  const days = useMemo(
    () =>
      buildPastDays(
        entries.filter((entry) => entry.meal),
        todayDate,
        locale,
      ),
    [entries, todayDate, locale],
  )

  // `gap-8` between days, as on Today, so the days read as groups.
  return (
    <div className="flex flex-col gap-8">
      {days.map((day) => (
        <div key={day.date} className="flex flex-col gap-2">
          <Heading variant="section" as="h2">
            {day.label}
            {day.dateLabel && (
              <>
                {' '}
                {/* The date is a detail beside the weekday, dimmed and at
                    normal weight, as on Today's day heading
                    (`TimelineDayCard`). */}
                <span className="text-muted-foreground font-normal">{day.dateLabel}</span>
              </>
            )}
          </Heading>
          <RowGroup>
            {day.entries.map(
              (entry) =>
                entry.meal && (
                  <PastMealRow
                    key={entry.id}
                    entryId={entry.id}
                    planId={planId}
                    meal={entry.meal}
                    mealType={entry.mealType}
                    status={entry.status}
                    rating={entry.rating}
                    householdSize={householdSize}
                    servingOverride={entry.servingOverride}
                    pantryDeducted={entry.pantryDeducted}
                    pantryItems={pantryItems}
                  />
                ),
            )}
          </RowGroup>
        </div>
      ))}
    </div>
  )
}
