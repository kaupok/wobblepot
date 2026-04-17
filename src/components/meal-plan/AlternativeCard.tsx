'use client'

import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MealCardBase } from './MealCardBase'
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
  onSelect,
  isSelecting,
  pantryIngredients,
}: AlternativeCardProps) {
  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex-1 p-4 pb-2">
        <MealCardBase meal={meal} pantryIngredients={pantryIngredients} nameHeadingLevel="h3" />
      </CardContent>
      <CardFooter className="p-4 pt-0">
        <Button className="w-full" onClick={() => onSelect(meal.id)} disabled={isSelecting}>
          {isSelecting ? 'Selecting...' : 'Select'}
        </Button>
      </CardFooter>
    </Card>
  )
}
