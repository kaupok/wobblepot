'use client'

import { useState, useMemo, useCallback } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { RegenerateModal } from '@/components/meal-plan/RegenerateModal'
import { MealLibraryModal } from '@/components/meal-plan/MealLibraryModal'
import { computeMealAvailability } from '@/components/meal-plan/AvailabilityIndicator'
import { IngredientList } from '@/components/meal-plan/IngredientList'
import { NutritionSummary } from '@/components/meal-plan/NutritionSummary'
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
  const [isRegenerateModalOpen, setIsRegenerateModalOpen] = useState(false)
  const [isLibraryOpen, setIsLibraryOpen] = useState(false)
  const [togglingIngredientIds, setTogglingIngredientIds] = useState<Set<string>>(new Set())

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
              <Button variant="outline" size="sm" onClick={() => setIsLibraryOpen(true)}>
                Add meal
              </Button>
            </div>
            <Body variant="muted">No meal planned</Body>
          </CardHeader>
        </Card>
        <MealLibraryModal
          open={isLibraryOpen}
          onOpenChange={setIsLibraryOpen}
          planId={planId}
          entryId={entryId}
          mealType={mealType}
          onSwapComplete={() => router.refresh()}
        />
      </>
    )
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-1">
              <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                {mealTypeLabels[mealType]}
              </div>
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
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsRegenerateModalOpen(true)}
              className="shrink-0"
            >
              Swap
            </Button>
          </div>
        </CardHeader>

        <div className="px-6 pt-4 pb-6">
          <IngredientList
            components={meal.components}
            householdSize={householdSize}
            pantryIngredients={pantryIngredients}
            onToggleAvailability={handleToggleAvailability}
            togglingIds={togglingIngredientIds}
            availability={availability}
          />
        </div>
      </Card>
      <RegenerateModal
        open={isRegenerateModalOpen}
        onOpenChange={setIsRegenerateModalOpen}
        planId={planId}
        entryId={entryId}
        mealType={mealType}
        householdSize={householdSize}
        currentMealName={meal.name}
        onSwapComplete={() => router.refresh()}
      />
    </>
  )
}
