'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TimelineDayCard } from './TimelineDayCard'
import type { TimelineDay, PantryIngredient, PantryItemFull } from '@/components/meal-plan/types'

interface TimelinePastSectionProps {
  days: TimelineDay[]
  planId: string
  householdSize: number
  pantryIngredients: PantryIngredient[]
  pantryItems: PantryItemFull[]
  onEntryUpdated: () => void
}

export function TimelinePastSection({
  days,
  planId,
  householdSize,
  pantryIngredients,
  pantryItems,
  onEntryUpdated,
}: TimelinePastSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Count past entries that still need action (planned status)
  const plannedCount = days.reduce(
    (count, day) => count + day.entries.filter((e) => e.status === 'planned' && e.meal).length,
    0,
  )

  if (days.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="ghost"
        size="sm"
        className="self-end"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronUp className="mr-1 h-4 w-4" />
        ) : (
          <ChevronDown className="mr-1 h-4 w-4" />
        )}
        {isExpanded ? 'Hide past meals' : 'Show past meals'}
        {plannedCount > 0 && (
          <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            {plannedCount} to catch up
          </span>
        )}
      </Button>
      {isExpanded && (
        <div className="flex flex-col gap-4">
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
      )}
    </div>
  )
}
