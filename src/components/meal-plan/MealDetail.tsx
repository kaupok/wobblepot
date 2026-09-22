'use client'

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Body } from '@/components/ui/typography'
import { NutritionDisclaimer } from '@/components/NutritionDisclaimer'
import { NutritionSummary } from './NutritionSummary'
import { IngredientList } from './IngredientList'
import { computeMealAvailability } from './AvailabilityIndicator'
import { PreparationTips } from './PreparationTips'
import { ServingControl } from './ServingControl'
import type { MealStatus } from './StatusSelect'
import type { MealData, PantryIngredient, StructuredTips } from './types'

interface MealDetailProps {
  meal: MealData
  /** The meal's hero illustration, rendered first (`MealImage`, HON-737) */
  image?: ReactNode
  householdSize: number
  /** Status of the plan entry this meal belongs to */
  status?: MealStatus
  /** Current effective servings (servingOverride or householdSize) */
  servings?: number
  /** Handler for serving count changes. Ignored for a completed entry. */
  onServingsChange?: (servings: number | null) => Promise<boolean>
  pantryIngredients?: PantryIngredient[]
  /** If provided, renders checkboxes to toggle ingredient availability */
  onToggleAvailability?: (ingredientId: string, hasIt: boolean) => void
  /** Ingredient IDs currently being toggled (for pending indicator) */
  togglingIds?: Set<string>
  /** Optimistic availability overrides from in-flight toggles */
  optimisticOverrides?: Map<string, boolean>
  /** If true, hides checkboxes and missing ingredient styling */
  hideAvailability?: boolean
  /** If true, hides the availability badge on finished meals */
  hideAvailabilityBadge?: boolean
  /** Preparation tips content */
  tips?: StructuredTips | null
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
  image,
  householdSize,
  status,
  servings,
  onServingsChange,
  pantryIngredients = [],
  onToggleAvailability,
  togglingIds,
  optimisticOverrides,
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
  const tDetail = useTranslations('meal-plan.detail')
  // Effective servings: use explicit prop if provided, otherwise householdSize
  const effectiveServings = servings ?? householdSize

  const availability = useMemo(() => {
    return computeMealAvailability(meal, pantryIngredients)
  }, [meal, pantryIngredients])

  const showPreparationSection = !!onHowToPrepare
  const showTips = showPreparationSection && isTipsExpanded
  // A completed entry's servings are what the pantry was charged for, and the
  // API refuses to change them (409, HON-652) — so show the count as the
  // static header instead of offering an edit that can only fail.
  const showServingControl = !!onServingsChange && status !== 'completed'

  return (
    <div className="flex flex-col gap-4">
      {image}

      {/* Meal description — seeded MealTranslation renders in the household locale */}
      {meal.description && <Body variant="muted">{meal.description}</Body>}

      {/* Nutrition summary */}
      {meal.nutrition && (
        <div className="flex flex-col gap-1">
          <NutritionSummary nutrition={meal.nutrition} components={meal.components} compact />
          <NutritionDisclaimer className="text-xs" />
        </div>
      )}

      {/* Time + Kid-friendly badge */}
      <div className="flex flex-wrap items-center gap-1.5">
        {meal.timeMinutes && (
          <span className="text-muted-foreground text-xs">
            {tDetail('timeMinutes', { count: meal.timeMinutes })}
          </span>
        )}
        {meal.kidFriendly && (
          <span className="bg-success-muted text-success rounded-full px-2 py-0.5 text-xs">
            {tDetail('kidFriendly')}
          </span>
        )}
      </div>

      {/* Ingredients, with the preparation tips beside them on md+ once shown */}
      <div className={cn('grid grid-cols-1 gap-4', showTips && 'md:grid-cols-2')}>
        <div className="flex flex-col gap-4">
          <IngredientList
            components={meal.components}
            servings={effectiveServings}
            householdSize={householdSize}
            pantryIngredients={pantryIngredients}
            onToggleAvailability={hideAvailability ? undefined : onToggleAvailability}
            togglingIds={togglingIds}
            optimisticOverrides={optimisticOverrides}
            availability={hideAvailabilityBadge ? null : availability}
            hideAvailability={hideAvailability}
            headerElement={
              showServingControl ? (
                // The control sits beside the title rather than inside
                // parentheses, where its padding read as stray spaces (HON-763).
                <div className="flex flex-wrap items-baseline gap-x-1">
                  <Body variant="small" className="font-semibold whitespace-nowrap">
                    {tDetail('ingredientsTitle')}
                  </Body>
                  <ServingControl
                    servings={effectiveServings}
                    householdSize={householdSize}
                    onServingsChange={onServingsChange}
                    disabled={hideAvailability}
                  />
                </div>
              ) : undefined
            }
          />

          {/* Collapsed tips reserve no panel — just the button (HON-763) */}
          {showPreparationSection && !isTipsExpanded && (
            <Button
              variant="outline"
              size="sm"
              className="w-full sm:w-auto sm:self-start"
              onClick={onHowToPrepare}
            >
              {tDetail('howToPrepare')}
            </Button>
          )}
        </div>

        {showTips && (
          <div className="bg-muted/50 rounded-lg p-4">
            <PreparationTips
              tips={tips ?? null}
              isLoading={isLoadingTips}
              error={tipsError ?? null}
              onRetry={onRetryTips ?? (() => {})}
              preparationNotes={meal.preparationNotes}
            />
            {tips && onHideTips && (
              <div className="mt-3 flex justify-center">
                <Button variant="ghost" size="sm" onClick={onHideTips}>
                  {tDetail('hideTips')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
