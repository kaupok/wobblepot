'use client'

import { useState, useMemo, useCallback } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { MealSelectorModal } from '@/components/meal-plan/MealSelectorModal'
import {
  computeMealAvailability,
  AvailabilityIndicator,
} from '@/components/meal-plan/AvailabilityIndicator'
import { IngredientList } from '@/components/meal-plan/IngredientList'
import { NutritionSummary } from '@/components/meal-plan/NutritionSummary'
import { PreparationTips } from './PreparationTips'
import type { MealData, PantryIngredient } from '@/components/meal-plan/types'
import type { MealType } from '@/generated/prisma/enums'

const mealTypeLabels: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
}

interface TomorrowMealCardProps {
  entryId: string
  planId: string
  meal: MealData | null
  mealType: MealType
  householdSize: number
  pantryIngredients: PantryIngredient[]
}

export function TomorrowMealCard({
  entryId,
  planId,
  meal,
  mealType,
  householdSize,
  pantryIngredients,
}: TomorrowMealCardProps) {
  const router = useRouter()
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)
  const [togglingIngredientIds, setTogglingIngredientIds] = useState<Set<string>>(new Set())
  const [isExpanded, setIsExpanded] = useState(false)
  const [tips, setTips] = useState<string | null>(null)
  const [isLoadingTips, setIsLoadingTips] = useState(false)
  const [tipsError, setTipsError] = useState<string | null>(null)
  const [isTipsExpanded, setIsTipsExpanded] = useState(false)

  const availability = useMemo(() => {
    if (!meal) return null
    return computeMealAvailability(meal, pantryIngredients)
  }, [meal, pantryIngredients])

  const handleToggleAvailability = useCallback(
    async (ingredientId: string, hasIt: boolean) => {
      setTogglingIngredientIds((prev) => new Set(prev).add(ingredientId))

      try {
        if (hasIt) {
          const response = await fetch('/api/pantry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ingredientId }),
          })

          if (!response.ok) {
            const data = await response.json()
            if (response.status !== 409) {
              throw new Error(data.error || 'Failed to add to pantry')
            }
          }
        } else {
          const response = await fetch(`/api/pantry/by-ingredient/${ingredientId}`, {
            method: 'DELETE',
          })

          if (!response.ok && response.status !== 404) {
            const data = await response.json()
            throw new Error(data.error || 'Failed to remove from pantry')
          }
        }

        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to update pantry')
      } finally {
        setTogglingIngredientIds((prev) => {
          const next = new Set(prev)
          next.delete(ingredientId)
          return next
        })
      }
    },
    [router],
  )

  const fetchTips = useCallback(async () => {
    setIsLoadingTips(true)
    setTipsError(null)
    setIsTipsExpanded(true)

    try {
      const response = await fetch(
        `/api/meal-plans/${planId}/entries/${entryId}/preparation-tips`,
        {
          method: 'POST',
        },
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Couldn't generate tips")
      }

      const data = await response.json()
      setTips(data.tips)
    } catch (error) {
      setTipsError(error instanceof Error ? error.message : "Couldn't generate tips. Try again.")
    } finally {
      setIsLoadingTips(false)
    }
  }, [planId, entryId])

  function handleHowToPrepare() {
    if (tips) {
      setIsTipsExpanded((prev) => !prev)
    } else {
      fetchTips()
    }
  }

  // Empty state - no meal planned
  if (!meal) {
    return (
      <>
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                {mealTypeLabels[mealType]}
              </div>
              <Button variant="outline" size="sm" onClick={() => setIsSelectorOpen(true)}>
                Add meal
              </Button>
            </div>
            <Body variant="muted">No meal planned</Body>
          </CardHeader>
        </Card>
        <MealSelectorModal
          open={isSelectorOpen}
          onOpenChange={setIsSelectorOpen}
          planId={planId}
          entryId={entryId}
          mealType={mealType}
          householdSize={householdSize}
          onSwapComplete={() => router.refresh()}
          mode="add"
        />
      </>
    )
  }

  return (
    <>
      <Card>
        <CardHeader className={isExpanded ? 'pb-0' : 'pb-4'}>
          {/* Top row: Meal type label + Swap button (matching main's new layout) */}
          <div className="flex items-center justify-between">
            <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
              {mealTypeLabels[mealType]}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSelectorOpen(true)}
              className="shrink-0"
            >
              Swap
            </Button>
          </div>

          {/* Meal info */}
          <CardTitle className="text-base leading-tight font-semibold">{meal.name}</CardTitle>
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

          {/* Collapsed view: Show availability badge and Details button */}
          {!isExpanded && (
            <div className="mt-3 flex flex-col gap-3">
              {availability && (
                <div className="flex justify-center">
                  <AvailabilityIndicator availability={availability} />
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsExpanded(true)}
                className="w-full"
              >
                Details
              </Button>
            </div>
          )}
        </CardHeader>

        {/* Expanded view: Ingredients list and prep tips */}
        {isExpanded && (
          <div className="flex flex-col gap-4 px-6 pt-4 pb-6">
            <IngredientList
              components={meal.components}
              householdSize={householdSize}
              pantryIngredients={pantryIngredients}
              onToggleAvailability={handleToggleAvailability}
              togglingIds={togglingIngredientIds}
              availability={availability}
            />

            {/* Prep tips section */}
            <div className="bg-muted/50 flex flex-col items-center justify-center gap-4 rounded-lg p-4">
              {isTipsExpanded ? (
                <div className="w-full">
                  <PreparationTips
                    tips={tips}
                    isLoading={isLoadingTips}
                    error={tipsError}
                    onRetry={fetchTips}
                  />
                  {tips && (
                    <div className="mt-3 flex justify-center">
                      <Button variant="ghost" size="sm" onClick={() => setIsTipsExpanded(false)}>
                        Hide tips
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={handleHowToPrepare}>
                  How to prepare
                </Button>
              )}
            </div>

            {/* Hide button to collapse */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsExpanded(false)}
              className="w-full"
            >
              Hide
            </Button>
          </div>
        )}
      </Card>
      <MealSelectorModal
        open={isSelectorOpen}
        onOpenChange={setIsSelectorOpen}
        planId={planId}
        entryId={entryId}
        mealType={mealType}
        householdSize={householdSize}
        currentMealName={meal.name}
        onSwapComplete={() => router.refresh()}
        mode="swap"
      />
    </>
  )
}
