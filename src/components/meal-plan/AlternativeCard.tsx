'use client'

import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { CardContent, CardFooter } from '@/components/ui/card'
import { Body } from '@/components/ui/typography'

import {
  AvailabilityIndicator,
  computeMealAvailability,
  hasPantryData,
} from './AvailabilityIndicator'
import { CookedLine } from './CookedLine'
import { MealCardBase } from './MealCardBase'
import { MealImageCard } from './MealImageCard'
import type { AlternativeMeal, PantryIngredient } from './types'

interface AlternativeCardProps {
  meal: AlternativeMeal
  householdServings: number
  onSelect: (mealId: string) => void
  isSelecting: boolean
  pantryIngredients?: PantryIngredient[]
  /** Opens the cook view for this meal over the picker (HON-1352). */
  onOpen: () => void
}

/**
 * One meal in the picker's grid. The household picks on the badges, the name,
 * the time and the to-buy count, so the card carries no nutrition and no
 * ingredient list: the cook view, opened from the name, shows both with
 * quantities (HON-1352). Only the name opens it; Select is the card's action.
 */
export function AlternativeCard({
  meal,
  onSelect,
  isSelecting,
  pantryIngredients,
  onOpen,
}: AlternativeCardProps) {
  const t = useTranslations('meal-plan.alternative')
  const nameButtonRef = useRef<HTMLButtonElement>(null)

  // The view hands focus back to whatever had it as it opened, so give it the
  // name first, as `RecipeCard` does.
  function open() {
    nameButtonRef.current?.focus({ preventScroll: true })
    onOpen()
  }
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
    // content instead of behind it (HON-750).
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
        {/* The dialog's title names the slot, so the cards do not (HON-945). */}
        <MealCardBase
          meal={meal}
          pantryIngredients={pantryIngredients}
          nameHeadingTag="h3"
          mealTypes="hide"
          ingredients="never"
          nutrition="hide"
          onNameClick={open}
          nameTarget="name"
          nameButtonRef={nameButtonRef}
        />
        {/* When the household last had it, on a meal from `/api/meals` (HON-1388). */}
        {meal.lastCookedOn !== undefined && (
          <div className="mt-2">
            <CookedLine
              lastCookedOn={meal.lastCookedOn}
              nextPlannedOn={meal.nextPlannedOn ?? null}
            />
          </div>
        )}
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
        {/* The pantry's verdict, after the meal's own rows, where the card on
            Today puts it (HON-816). */}
        {availability && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <AvailabilityIndicator availability={availability} />
          </div>
        )}
      </CardContent>
    </MealImageCard>
  )
}
