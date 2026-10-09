'use client'

import { useEffect, useRef } from 'react'
import { MealCard } from '@/components/meal-plan/MealCard'
import { Body, Heading } from '@/components/ui/typography'
import { TimelineEmptySlot } from './TimelineEmptySlot'
import { useTranslations } from 'next-intl'
import type { TimelineDay, PantryIngredient, PantryItemFull } from '@/components/meal-plan/types'
import type { MealType } from '@/generated/prisma/enums'

const mealTypeOrder = { breakfast: 0, lunch: 1, dinner: 2 } as const

interface TimelineDayCardProps {
  day: TimelineDay
  planId: string
  householdServings: number
  pantryIngredients: PantryIngredient[]
  pantryItems: PantryItemFull[]
  onEntryUpdated: () => void
  /** A card's meal was cleared; its slot should take focus once it renders. */
  onEntryCleared?: (slot: { date: string; mealType: MealType }) => void
  /** The empty slot to focus as it mounts, set after a clear. */
  focusSlot?: MealType
  onSlotFocused?: () => void
  /**
   * Focus the day heading as the card renders: a plan was just generated and
   * the Generate button left the page, taking focus with it (HON-1139).
   */
  focusHeading?: boolean
  /** Called once the card has acted on `focusHeading`, so the page can drop it. */
  onHeadingFocused?: () => void
}

export function TimelineDayCard({
  day,
  planId,
  householdServings,
  pantryIngredients,
  pantryItems,
  onEntryUpdated: _onEntryUpdated,
  onEntryCleared,
  focusSlot,
  onSlotFocused,
  focusHeading = false,
  onHeadingFocused,
}: TimelineDayCardProps) {
  const tDay = useTranslations('meal-plan.day')
  const headingRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!focusHeading) return
    // Only from the body: when the Generate button is still on the page, it
    // keeps focus, and so does a user who moved on before the refresh landed.
    if (!document.activeElement || document.activeElement === document.body) {
      headingRef.current?.focus()
    }
    onHeadingFocused?.()
  }, [focusHeading, onHeadingFocused])
  // The heading's text as one string — "Saturday Oct 3", or just "Tomorrow" —
  // so an empty slot can say which day it belongs to (HON-807).
  const dayLabel = day.dateLabel ? `${day.label} ${day.dateLabel}` : day.label
  const relativeDay = day.isToday ? 'today' : day.isTomorrow ? 'tomorrow' : undefined
  const order = (mealType: string) => mealTypeOrder[mealType as keyof typeof mealTypeOrder] ?? 3
  const entries = [...day.entries].sort((a, b) => order(a.mealType) - order(b.mealType))
  const emptySlots = [...day.emptySlots].sort((a, b) => order(a) - order(b))

  return (
    <div className="flex flex-col gap-2">
      {/* An empty slot is a "+ Dinner" button on the heading's line rather
          than a row of its own, so an empty day takes one line (HON-1111). The
          buttons sit beside the heading, not inside it, so the outline still
          reads "Saturday Sep 26"; they wrap below it, together, on a narrow
          screen. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {/* `tabIndex={-1}`: the heading can take focus after a generation
            without joining the tab order. */}
        <Heading
          ref={headingRef}
          variant="section"
          as="h2"
          tabIndex={-1}
          className={day.isToday ? 'text-primary' : undefined}
        >
          {day.label}
          {day.dateLabel && (
            <>
              {' '}
              {/* The date is a detail beside the weekday: dimmed and at normal
                  weight, in the same heading so the outline still reads
                  "Saturday Sep 26". A plain space, not a formatter's (HON-777). */}
              <span className="text-muted-foreground font-normal">{day.dateLabel}</span>
            </>
          )}
        </Heading>
        {emptySlots.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {emptySlots.map((mealType) => (
              <TimelineEmptySlot
                key={mealType}
                planId={planId}
                date={day.date}
                dayLabel={dayLabel}
                relativeDay={relativeDay}
                mealType={mealType}
                householdServings={householdServings}
                pantryIngredients={pantryIngredients}
                autoFocus={mealType === focusSlot}
                onAutoFocused={onSlotFocused}
              />
            ))}
          </div>
        )}
      </div>
      {entries.length > 0 ? (
        <div className="flex flex-col gap-2">
          {/* The slot's label (Dinner, Lunch) is the card's own first row:
              `MealCard` renders `MealTypeBadge`. */}
          {entries.map((entry) => (
            <MealCard
              key={entry.id}
              entryId={entry.id}
              planId={planId}
              date={entry.date}
              meal={entry.meal}
              mealType={entry.mealType}
              status={entry.status}
              rating={entry.rating}
              householdServings={householdServings}
              pantryIngredients={pantryIngredients}
              pantryItems={pantryItems}
              note={entry.note}
              noteX={entry.noteX}
              noteY={entry.noteY}
              servingOverride={entry.servingOverride}
              pantryDeducted={entry.pantryDeducted}
              preparationTips={entry.preparationTips}
              conflicts={entry.conflicts}
              onCleared={() => onEntryCleared?.({ date: day.date, mealType: entry.mealType })}
            />
          ))}
        </div>
      ) : (
        emptySlots.length === 0 && <Body variant="muted">{tDay('noMealsPlanned')}</Body>
      )}
    </div>
  )
}
