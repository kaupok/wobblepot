'use client'

import type { ReactNode } from 'react'
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
  /** Rendered at the end of the heading row, e.g. the Today overflow menu. */
  headerAction?: ReactNode
}

export function TimelineDayCard({
  day,
  planId,
  householdSize,
  pantryIngredients,
  pantryItems,
  onEntryUpdated: _onEntryUpdated,
  headerAction,
}: TimelineDayCardProps) {
  const tDay = useTranslations('meal-plan.day')
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

  // Visual styling based on day type
  let containerClass = 'flex flex-col gap-2'
  if (day.isPast) {
    containerClass += ' opacity-70'
  }

  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between gap-2">
        <Heading variant="section" as="h5" className={day.isToday ? 'text-primary' : undefined}>
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
        {headerAction && <div className="shrink-0">{headerAction}</div>}
      </div>
      {slots.length === 0 ? (
        <Body variant="muted">{tDay('noMealsPlanned')}</Body>
      ) : (
        <div className="flex flex-col gap-2">
          {slots.map((slot) => {
            if (slot.type === 'empty' && day.isPast) return null

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
                    isPast={day.isPast}
                    pantryIngredients={pantryIngredients}
                    pantryItems={pantryItems}
                    note={slot.entry.note}
                    servingOverride={slot.entry.servingOverride}
                    pantryDeducted={slot.entry.pantryDeducted}
                  />
                ) : (
                  <TimelineEmptySlot
                    planId={planId}
                    date={day.date}
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
