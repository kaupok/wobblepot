'use client'

import { MealCard } from '@/components/meal-plan/MealCard'
import { TimelineEmptySlot } from './TimelineEmptySlot'
import type { TimelineDay, PantryIngredient, PantryItemFull } from '@/components/meal-plan/types'
import type { MealType } from '@/generated/prisma/enums'

const mealTypeOrder = { breakfast: 0, lunch: 1, dinner: 2 } as const

const mealTypeLabels: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
}

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
  let containerClass = 'flex flex-col gap-2 rounded-lg border p-3'
  if (day.isToday) {
    containerClass += ' border-primary/30 bg-primary/5'
  } else if (day.isTomorrow) {
    containerClass += ' border-primary/15'
  } else if (day.isPast) {
    containerClass += ' opacity-70'
  }

  return (
    <div className={containerClass}>
      <div className="flex items-baseline gap-2">
        <span className={`text-sm font-semibold ${day.isToday ? 'text-primary' : ''}`}>
          {day.label}
        </span>
        {day.isToday && (
          <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px] font-medium">
            Today
          </span>
        )}
      </div>
      {slots.length === 0 ? (
        <span className="text-muted-foreground text-xs">No meals planned</span>
      ) : (
        <div className="flex flex-col gap-2">
          {slots.map((slot) => {
            const mealType = slot.type === 'entry' ? slot.entry.mealType : slot.mealType

            if (slot.type === 'empty' && day.isPast) return null

            return (
              <div key={slot.type === 'entry' ? slot.entry.id : `empty-${slot.mealType}`}>
                <div className="text-muted-foreground mb-1 text-[9px] font-medium tracking-wide uppercase">
                  {mealTypeLabels[mealType as MealType]}
                </div>
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
