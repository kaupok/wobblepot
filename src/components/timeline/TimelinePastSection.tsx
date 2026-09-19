'use client'

import type { Ref } from 'react'
import { TimelineDayCard } from './TimelineDayCard'
import type { TimelineDay, PantryIngredient, PantryItemFull } from '@/components/meal-plan/types'

/** Past entries that still need action (planned status with a meal). */
export function countPastCatchUp(days: TimelineDay[]): number {
  return days.reduce(
    (count, day) => count + day.entries.filter((e) => e.status === 'planned' && e.meal).length,
    0,
  )
}

interface TimelinePastSectionProps {
  days: TimelineDay[]
  expanded: boolean
  planId: string
  householdSize: number
  pantryIngredients: PantryIngredient[]
  pantryItems: PantryItemFull[]
  onEntryUpdated: () => void
  /** Attached to the list, whose top edge is the first past day — the scroll target on expand. */
  ref?: Ref<HTMLDivElement>
}

export function TimelinePastSection({
  days,
  expanded,
  planId,
  householdSize,
  pantryIngredients,
  pantryItems,
  onEntryUpdated,
  ref,
}: TimelinePastSectionProps) {
  if (!expanded || days.length === 0) return null

  return (
    <div ref={ref} className="scroll-mt-below-header flex flex-col gap-6">
      {days.map((day) => (
        <TimelineDayCard
          key={day.date}
          day={day}
          planId={planId}
          householdSize={householdSize}
          pantryIngredients={pantryIngredients}
          pantryItems={pantryItems}
          onEntryUpdated={onEntryUpdated}
        />
      ))}
    </div>
  )
}
