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
  householdSize: number
  pantryIngredients: PantryIngredient[]
  pantryItems: PantryItemFull[]
  onEntryUpdated: () => void
}

export function TimelineDayCard({
  day,
  planId,
  householdSize,
  pantryIngredients,
  pantryItems,
  onEntryUpdated: _onEntryUpdated,
}: TimelineDayCardProps) {
  const tDay = useTranslations('meal-plan.day')
  // The heading's text as one string — "Saturday Oct 3", or just "Tomorrow" —
  // so an empty slot can say which day it belongs to (HON-807).
  const dayLabel = day.dateLabel ? `${day.label} ${day.dateLabel}` : day.label
  const relativeDay = day.isToday ? 'today' : day.isTomorrow ? 'tomorrow' : undefined
  // Build a combined list of entries and empty slots, sorted by meal type
  type SlotItem =
    | { type: 'entry'; entry: (typeof day.entries)[0]; order: number }
    | { type: 'empty'; mealType: (typeof day.emptySlots)[0]; order: number }

  const slots: SlotItem[] = [
    ...day.entries.map((entry) => ({
      type: 'entry' as const,
      entry,
      order: mealTypeOrder[entry.mealType as keyof typeof mealTypeOrder] ?? 3,
    })),
    ...day.emptySlots.map((mealType) => ({
      type: 'empty' as const,
      mealType,
      order: mealTypeOrder[mealType as keyof typeof mealTypeOrder] ?? 3,
    })),
  ].sort((a, b) => a.order - b.order)

  return (
    <div className="flex flex-col gap-2">
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
      {slots.length === 0 ? (
        <Body variant="muted">{tDay('noMealsPlanned')}</Body>
      ) : (
        <div className="flex flex-col gap-2">
          {slots.map((slot) => {
            // The slot's label (Dinner, Lunch) is the card's own first row:
            // `MealCard` and `TimelineEmptySlot` render `MealTypeBadge`.
            return (
              <div key={slot.type === 'entry' ? slot.entry.id : `empty-${slot.mealType}`}>
                {slot.type === 'entry' ? (
                  <MealCard
                    entryId={slot.entry.id}
                    planId={planId}
                    meal={slot.entry.meal}
                    mealType={slot.entry.mealType}
                    status={slot.entry.status}
                    rating={slot.entry.rating}
                    householdSize={householdSize}
                    pantryIngredients={pantryIngredients}
                    pantryItems={pantryItems}
                    note={slot.entry.note}
                    noteX={slot.entry.noteX}
                    noteY={slot.entry.noteY}
                    servingOverride={slot.entry.servingOverride}
                    pantryDeducted={slot.entry.pantryDeducted}
                    preparationTips={slot.entry.preparationTips}
                  />
                ) : (
                  <TimelineEmptySlot
                    planId={planId}
                    date={day.date}
                    dayLabel={dayLabel}
                    relativeDay={relativeDay}
                    mealType={slot.mealType}
                    householdSize={householdSize}
                    pantryIngredients={pantryIngredients}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
