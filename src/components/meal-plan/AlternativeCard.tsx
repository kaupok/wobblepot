'use client'

import { useMemo } from 'react'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import {
  AvailabilityIndicator,
  computeMealAvailability,
  hasPantryData,
} from './AvailabilityIndicator'
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
  // Same gate as the ingredient rows in `MealCardBase`, so a staples-only
  // pantry shows neither the marks nor a badge counting everything missing.
  const availability = useMemo(
    () =>
      hasPantryData(pantryIngredients) && pantryIngredients
        ? computeMealAvailability(meal, pantryIngredients)
        : null,
    [meal, pantryIngredients],
  )
  return (
    // The dialog's cards are taller than wide, so the image sits below the
    // ingredients instead of behind them (HON-750).
    <MealImageCard
      meal={meal}
      layout="bottom"
      // `sm`: the content's `p-4` is the card's padding, as in `MealList`.
      size="sm"
      className="flex h-full flex-col"
      footer={
        <CardFooter className="p-4 pt-0">
          {/* Three cards offer the same choice, so none is the primary: outline,
              and as wide as its label from `md` (HON-943). */}
          <Button
            variant="outline"
            className="w-full md:w-auto md:self-start"
            onClick={() => onSelect(meal.id)}
            disabled={isSelecting}
          >
            {isSelecting ? t('selecting') : t('select')}
          </Button>
        </CardFooter>
      }
    >
      <CardContent className="flex-1 p-4 pb-2">
        <MealCardBase meal={meal} pantryIngredients={pantryIngredients} nameHeadingTag="h3" />
        {/* Why this suggestion ranked where it did, when the household's own ratings moved it (HON-340). */}
        {meal.ratingSignal && (
          <div className="text-muted-foreground mt-2 flex items-center gap-1">
            {meal.ratingSignal === 'liked' ? (
              <ThumbsUp className="size-3.5" aria-hidden />
            ) : (
              <ThumbsDown className="size-3.5" aria-hidden />
            )}
            <Body variant="small">
              {t(meal.ratingSignal === 'liked' ? 'ratedUp' : 'ratedDown')}
            </Body>
          </div>
        )}
        {/* The pantry's verdict, as the last row, where the card on Today puts
            it (HON-816). */}
        {availability && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <AvailabilityIndicator availability={availability} />
          </div>
        )}
      </CardContent>
    </MealImageCard>
  )
}
