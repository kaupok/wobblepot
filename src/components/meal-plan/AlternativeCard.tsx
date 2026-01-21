'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { AvailabilityIndicator, computeMealAvailability } from './AvailabilityIndicator'
import type { AlternativeMeal, PantryIngredient } from './types'

interface AlternativeCardProps {
  meal: AlternativeMeal
  householdSize: number
  onSelect: (mealId: string) => void
  isSelecting: boolean
  pantryIngredients?: PantryIngredient[]
}

export function AlternativeCard({
  meal,
  householdSize,
  onSelect,
  isSelecting,
  pantryIngredients = [],
}: AlternativeCardProps) {
  // AlternativeMeal has a similar structure to MealData, but we need to adapt it
  const availability = useMemo(() => {
    const mealForAvailability = {
      id: meal.id,
      name: meal.name,
      kidFriendly: meal.kidFriendly,
      timeMinutes: meal.timeMinutes,
      components: meal.components,
      nutrition: meal.nutrition,
    }
    return computeMealAvailability(mealForAvailability, pantryIngredients)
  }, [meal, pantryIngredients])

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-1">
          <span className="leading-tight font-medium">{meal.name}</span>
          <AvailabilityIndicator availability={availability} />
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {meal.timeMinutes && <span>{meal.timeMinutes} min</span>}
            {meal.nutrition && (
              <span className="text-foreground font-medium">
                {Math.round(meal.nutrition.calories)} kcal
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {meal.kidFriendly && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
                Kid-friendly
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 pb-3">
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
