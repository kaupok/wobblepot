'use client'

import { useTranslations } from 'next-intl'
import { CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MealCardBase } from './MealCardBase'
import { MealImageCard } from './MealImageCard'
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
  const t = useTranslations('meal-plan.alternative')
  return (
    // The dialog's cards are taller than wide, so the image sits below the
    // ingredients instead of behind them (HON-750).
    <MealImageCard
      meal={meal}
      layout="bottom"
      className="flex h-full flex-col"
      footer={
        <CardFooter className="p-4 pt-0">
          <Button className="w-full" onClick={() => onSelect(meal.id)} disabled={isSelecting}>
            {isSelecting ? t('selecting') : t('select')}
          </Button>
        </CardFooter>
      }
    >
      <CardContent className="flex-1 p-4 pb-2">
        <MealCardBase meal={meal} pantryIngredients={pantryIngredients} nameHeadingTag="h3" />
      </CardContent>
    </MealImageCard>
  )
}
