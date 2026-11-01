'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'

import type { PantryItemFull, TimelineDay } from '@/components/meal-plan/types'
import { Button } from '@/components/ui/button'
import { RowGroup } from '@/components/ui/row-group'
import { Heading } from '@/components/ui/typography'
import type { MealType } from '@/generated/prisma/enums'

import { DayAddMenu } from './DayAddMenu'
import type { LogMode } from './EmptySlotController'
import { PastEmptyRow } from './PastEmptyRow'
import { PastFridgeRow } from './PastFridgeRow'
import { PastMealRow } from './PastMealRow'

interface PastMealsListProps {
  /** From `buildPastDays`: every past day with a row or an empty slot, newest first. */
  days: TimelineDay[]
  planId: string
  householdServings: number
  pantryItems: PantryItemFull[]
  /** What a log offers first: the household's usual meals and fridge-meal words. */
  log: Omit<LogMode, 'dayLabel'>
  /** How many weeks back the page reaches. */
  weeks: number
  /** False once the range reaches the household's first day. */
  hasEarlierWeek: boolean
}

interface FocusSlot {
  date: string
  mealType: MealType
  /** `row` after a log, which fills the slot; `empty` after Remove, which clears it. */
  target: 'row' | 'empty'
}

const headingId = (date: string) => `past-day-${date}`

/**
 * The past days on `/past-meals`, newest first. Each day is its heading and
 * one `RowGroup`, breakfast to dinner: the page is a task list, so a meal is
 * a row with one-click Cooked and Skipped, not a Today card (HON-1018). A
 * recipe meal, a fridge meal and an empty slot each have their own row
 * (HON-1383). The heading's "+ Add" logs a meal type the day does not expect
 * (HON-1519). "Show the week before" reaches back a week at a time.
 */
export function PastMealsList({
  days,
  planId,
  householdServings,
  pantryItems,
  log,
  weeks,
  hasEarlierWeek,
}: PastMealsListProps) {
  const t = useTranslations('pastMeals')
  const router = useRouter()
  const [isLoadingWeek, startLoadingWeek] = useTransition()
  // A slot whose row was just replaced: a log turned Add into a meal row, or
  // Remove turned a meal row into Add. The row unmounted with focus, so the
  // one that replaces it takes focus once the refresh lands.
  const [focusSlot, setFocusSlot] = useState<FocusSlot | null>(null)
  const clearFocusSlot = useCallback(() => setFocusSlot(null), [])

  // The oldest day shown when "Show the week before" was pressed. Once the
  // new days render, focus moves to the first of them: the button may be gone,
  // and the new week is what the user asked to see.
  const earlierThanRef = useRef<string | null>(null)
  useEffect(() => {
    const earlierThan = earlierThanRef.current
    if (!earlierThan) return
    const firstNew = days.find((day) => day.date < earlierThan)
    if (!firstNew) return
    earlierThanRef.current = null
    document.getElementById(headingId(firstNew.date))?.focus()
  }, [days])

  function showWeekBefore() {
    if (isLoadingWeek) return
    earlierThanRef.current = days.at(-1)?.date ?? null
    startLoadingWeek(() => {
      router.push(`/past-meals?weeks=${weeks + 1}`, { scroll: false })
    })
  }

  // Keyed by target as well: until the refresh lands the old row is still
  // mounted, and must not take the focus meant for its replacement.
  const isFocusSlot = (date: string, mealType: MealType, target: FocusSlot['target']) =>
    focusSlot?.date === date && focusSlot.mealType === mealType && focusSlot.target === target

  // `gap-8` between days, as on Today, so the days read as groups.
  return (
    <div className="flex flex-col gap-8">
      {days.map((day) => {
        const dayLabel = day.dateLabel ? `${day.label} ${day.dateLabel}` : day.label
        const rows = [
          ...day.entries.map((entry) => ({ mealType: entry.mealType, entry })),
          ...day.emptySlots.map((mealType) => ({ mealType, entry: null })),
        ].sort((a, b) => MEAL_TYPE_ORDER[a.mealType] - MEAL_TYPE_ORDER[b.mealType])
        return (
          <div key={day.date} className="flex flex-col gap-2">
            {/* "+ Add" sits beside the heading, not inside it, so the outline
                still reads the day; it wraps below it on a narrow screen, as on
                Today (`TimelineDayCard`). The expected empty slots keep their
                row's Add, so this menu offers only the other meal types. */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              {/* Focusable from script only, for "Show the week before". */}
              <Heading variant="section" as="h2" id={headingId(day.date)} tabIndex={-1}>
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
              {day.otherSlots.length > 0 && (
                <DayAddMenu
                  planId={planId}
                  date={day.date}
                  dayLabel={dayLabel}
                  emptySlots={[]}
                  otherSlots={day.otherSlots}
                  householdServings={householdServings}
                  pantryItems={pantryItems}
                  log={log}
                  buttonStyle="heading"
                  onPicked={(mealType) => setFocusSlot({ date: day.date, mealType, target: 'row' })}
                />
              )}
            </div>
            <RowGroup>
              {rows.map(({ mealType, entry }) => {
                const slot = { date: day.date, mealType }
                if (!entry) {
                  return (
                    <PastEmptyRow
                      key={`empty-${mealType}`}
                      planId={planId}
                      date={day.date}
                      dayLabel={dayLabel}
                      mealType={mealType}
                      householdServings={householdServings}
                      pantryItems={pantryItems}
                      log={log}
                      autoFocus={isFocusSlot(day.date, mealType, 'empty')}
                      onFocused={clearFocusSlot}
                      onLogged={() => setFocusSlot({ ...slot, target: 'row' })}
                    />
                  )
                }
                const entryProps = {
                  entryId: entry.id,
                  planId,
                  date: day.date,
                  mealType,
                  status: entry.status,
                  note: entry.note,
                  noteX: entry.noteX,
                  noteY: entry.noteY,
                  pantryDeducted: entry.pantryDeducted,
                  pantryItems,
                  autoFocus: isFocusSlot(day.date, mealType, 'row'),
                  onFocused: clearFocusSlot,
                  onCleared: () => setFocusSlot({ ...slot, target: 'empty' }),
                }
                return entry.meal ? (
                  <PastMealRow
                    key={entry.id}
                    meal={entry.meal}
                    rating={entry.rating}
                    householdServings={householdServings}
                    servingOverride={entry.servingOverride}
                    {...entryProps}
                  />
                ) : (
                  <PastFridgeRow key={entry.id} items={entry.items ?? []} {...entryProps} />
                )
              })}
            </RowGroup>
          </div>
        )
      })}
      {hasEarlierWeek && (
        <div>
          {/* Not `disabled`: a disabled button drops focus (HON-803). */}
          <Button
            variant="outline"
            aria-disabled={isLoadingWeek || undefined}
            onClick={showWeekBefore}
          >
            {t('showWeekBefore')}
          </Button>
        </div>
      )}
    </div>
  )
}

const MEAL_TYPE_ORDER: Record<MealType, number> = { breakfast: 0, lunch: 1, dinner: 2 }
