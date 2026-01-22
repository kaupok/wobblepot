'use client'

import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { NutritionSummary } from './NutritionSummary'
import type { AlternativeMeal } from './types'

interface AlternativeCardProps {
  meal: AlternativeMeal
  householdSize: number
  onSelect: (mealId: string) => void
  isSelecting: boolean
}

export function AlternativeCard({
  meal,
  householdSize,
  onSelect,
  isSelecting,
}: AlternativeCardProps) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-1">
          <span className="leading-tight font-medium">{meal.name}</span>
          {meal.nutrition && <NutritionSummary nutrition={meal.nutrition} compact />}
          <div className="flex flex-wrap items-center gap-1.5">
            {meal.timeMinutes && (
              <span className="text-muted-foreground text-xs">{meal.timeMinutes} min</span>
            )}
            {meal.kidFriendly && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
                Kid-friendly
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 pb-3">
        <div className="flex flex-col gap-1">
          <Body variant="small" className="font-semibold">
            Ingredients (serves {householdSize})
          </Body>
          <ul className="text-muted-foreground ml-4 list-disc text-sm">
            {meal.components.map((comp) => (
              <li key={comp.ingredient.id}>{comp.ingredient.name}</li>
            ))}
          </ul>
        </div>
      </CardContent>
      <CardFooter className="pt-0">
        <Button className="w-full" onClick={() => onSelect(meal.id)} disabled={isSelecting}>
          {isSelecting ? 'Selecting...' : 'Select'}
        </Button>
      </CardFooter>
    </Card>
  )
}
