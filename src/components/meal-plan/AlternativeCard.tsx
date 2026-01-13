'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import type { AlternativeMeal } from './types'

interface AlternativeCardProps {
  meal: AlternativeMeal
  onSelect: (mealId: string) => void
  isSelecting: boolean
}

export function AlternativeCard({ meal, onSelect, isSelecting }: AlternativeCardProps) {
  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <span className="font-medium">{meal.name}</span>
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
              {meal.timeMinutes && <span>{meal.timeMinutes} min</span>}
              {meal.kidFriendly && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  Kid-friendly
                </span>
              )}
            </div>
          </div>
          <Button size="sm" onClick={() => onSelect(meal.id)} disabled={isSelecting}>
            {isSelecting ? 'Selecting...' : 'Select'}
          </Button>
        </div>
        <Body variant="muted">{meal.reason}</Body>
      </CardContent>
    </Card>
  )
}
