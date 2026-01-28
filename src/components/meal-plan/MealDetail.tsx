'use client'

import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { NutritionSummary } from './NutritionSummary'
import { IngredientList } from './IngredientList'
import { computeMealAvailability } from './AvailabilityIndicator'
import { PreparationTips } from '@/components/today/PreparationTips'
import type { MealData, PantryIngredient } from './types'

interface MealDetailProps {
  meal: MealData
  householdSize: number
  pantryIngredients?: PantryIngredient[]
  /** If provided, renders checkboxes to toggle ingredient availability */
  onToggleAvailability?: (ingredientId: string, hasIt: boolean) => void
  /** Ingredient IDs currently being toggled (for loading state) */
  togglingIds?: Set<string>
  /** If true, hides checkboxes and missing ingredient styling */
  hideAvailability?: boolean
  /** If true, hides the availability badge on finished meals */
  hideAvailabilityBadge?: boolean
  /** Preparation tips content */
  tips?: string | null
  /** Whether tips are currently loading */
  isLoadingTips?: boolean
  /** Error message from loading tips */
  tipsError?: string | null
  /** Retry handler for failed tips fetch */
  onRetryTips?: () => void
  /** Whether tips section is expanded */
  isTipsExpanded?: boolean
  /** Handler for "How to prepare" button click */
  onHowToPrepare?: () => void
  /** Handler for "Hide tips" button click */
  onHideTips?: () => void
}

export function MealDetail({
  meal,
  householdSize,
  pantryIngredients = [],
  onToggleAvailability,
  togglingIds,
  hideAvailability = false,
  hideAvailabilityBadge = false,
  tips = null,
  isLoadingTips = false,
  tipsError = null,
  onRetryTips,
  isTipsExpanded = false,
  onHowToPrepare,
  onHideTips,
}: MealDetailProps) {
  const availability = useMemo(() => {
    return computeMealAvailability(meal, pantryIngredients)
  }, [meal, pantryIngredients])

  const showPreparationSection = !!onHowToPrepare

  return (
    <div className="flex flex-col gap-4">
      {/* Nutrition summary */}
      {meal.nutrition && (
        <NutritionSummary nutrition={meal.nutrition} components={meal.components} compact />
      )}

      {/* Time + Kid-friendly badge */}
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

      {/* Ingredients + Preparation tips side-by-side on md+ */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Ingredients (left) */}
        <IngredientList
          components={meal.components}
          householdSize={householdSize}
          pantryIngredients={pantryIngredients}
          onToggleAvailability={hideAvailability ? undefined : onToggleAvailability}
          togglingIds={togglingIds}
          availability={hideAvailabilityBadge ? null : availability}
          hideAvailability={hideAvailability}
        />

        {/* Preparation tips (right) */}
        {showPreparationSection && (
          <div className="bg-muted/50 flex flex-col items-center justify-center gap-4 rounded-lg p-4">
            {isTipsExpanded ? (
              <div className="w-full">
                <PreparationTips
                  tips={tips ?? null}
                  isLoading={isLoadingTips}
                  error={tipsError ?? null}
                  onRetry={onRetryTips ?? (() => {})}
                />
                {tips && onHideTips && (
                  <div className="mt-3 flex justify-center">
                    <Button variant="ghost" size="sm" onClick={onHideTips}>
                      Hide tips
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={onHowToPrepare}>
                How to prepare
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
