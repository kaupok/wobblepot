'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { MealSelectorModal } from '@/components/meal-plan/MealSelectorModal'
import { MealDetail } from '@/components/meal-plan/MealDetail'
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
  const [tips, setTips] = useState<string | null>(null)
  const [isLoadingTips, setIsLoadingTips] = useState(false)
  const [tipsError, setTipsError] = useState<string | null>(null)
  const [isTipsExpanded, setIsTipsExpanded] = useState(false)

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
        <CardHeader className="pb-0">
          {/* Top row: Meal type label + Swap button */}
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

          {/* Meal name */}
          <CardTitle className="text-base leading-tight font-semibold">{meal.name}</CardTitle>
        </CardHeader>

        {/* Full meal detail - always shown */}
        <div className="px-6 pt-4 pb-6">
          <MealDetail
            meal={meal}
            householdSize={householdSize}
            pantryIngredients={pantryIngredients}
            onToggleAvailability={handleToggleAvailability}
            togglingIds={togglingIngredientIds}
            tips={tips}
            isLoadingTips={isLoadingTips}
            tipsError={tipsError}
            onRetryTips={fetchTips}
            isTipsExpanded={isTipsExpanded}
            onHowToPrepare={handleHowToPrepare}
            onHideTips={() => setIsTipsExpanded(false)}
          />
        </div>
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
