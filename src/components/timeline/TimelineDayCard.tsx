'use client'

import { MealCard } from '@/components/meal-plan/MealCard'
import { Body, Heading } from '@/components/ui/typography'
import { TimelineEmptySlot } from './TimelineEmptySlot'
import { useTranslations } from 'next-intl'
import type { TimelineDay, PantryIngredient, PantryItemFull } from '@/components/meal-plan/types'

const mealTypeOrder = { breakfast: 0, lunch: 1, dinner: 2 } as const

interface TimelineDayCardProps {
  day: TimelineDay
  planId: string
  householdServings: number
  pantryIngredients: PantryIngredient[]
  pantryItems: PantryItemFull[]
  onEntryUpdated: () => void
}

export function TimelineDayCard({
  day,
  planId,
  householdServings,
  pantryIngredients,
  pantryItems,
  onEntryUpdated: _onEntryUpdated,
}: TimelineDayCardProps) {
  const tDay = useTranslations('meal-plan.day')
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
        <Heading variant="section" as="h2" className={day.isToday ? 'text-primary' : undefined}>
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
            />
          ))}
        </div>
      ) : (
        emptySlots.length === 0 && <Body variant="muted">{tDay('noMealsPlanned')}</Body>
      )}
    </div>
  )
}
