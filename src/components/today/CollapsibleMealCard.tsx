'use client'

import { useState, useMemo, useCallback } from 'react'
import { toast } from 'sonner'
import { ChevronDown } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { MealDetailModal } from '@/components/meal-plan/MealDetailModal'
import { RegenerateModal } from '@/components/meal-plan/RegenerateModal'
import { MealLibraryModal } from '@/components/meal-plan/MealLibraryModal'
import {
  AvailabilityIndicator,
  computeMealAvailability,
} from '@/components/meal-plan/AvailabilityIndicator'
import { IngredientList } from '@/components/meal-plan/IngredientList'
import { NutritionSummary } from '@/components/meal-plan/NutritionSummary'
import type { MealData, PantryIngredient } from '@/components/meal-plan/types'
import type { MealType } from '@/generated/prisma/enums'

const mealTypeLabels: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
}

interface CollapsibleMealCardProps {
  entryId: string
  planId: string
  meal: MealData | null
  mealType: MealType
  householdSize: number
  pantryIngredients: PantryIngredient[]
  defaultExpanded?: boolean
}

export function CollapsibleMealCard({
  entryId,
  planId,
  meal,
  mealType,
  householdSize,
  pantryIngredients,
  defaultExpanded = false,
}: CollapsibleMealCardProps) {
  const router = useRouter()
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
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
          <CardHeader className="pb-2">
            <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
              {mealTypeLabels[mealType]}
            </div>
          </CardHeader>
          <CardContent className="flex items-center justify-between pb-3">
            <Body variant="muted">No meal planned</Body>
            <Button variant="outline" size="sm" onClick={() => setIsLibraryOpen(true)}>
              Add meal
            </Button>
          </CardContent>
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
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                    {mealTypeLabels[mealType]}
                  </div>
                  <CardTitle className="text-base leading-tight font-semibold">
                    {meal.name}
                  </CardTitle>
                  {!isExpanded && availability && (
                    <AvailabilityIndicator availability={availability} />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {meal.timeMinutes && (
                    <span className="text-muted-foreground text-xs">{meal.timeMinutes} min</span>
                  )}
                  {meal.kidFriendly && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      Kid-friendly
                    </span>
                  )}
                  <ChevronDown
                    className={`text-muted-foreground h-4 w-4 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                  />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="flex flex-col gap-4 pb-3">
              {meal.nutrition && <NutritionSummary nutrition={meal.nutrition} compact />}
              <IngredientList
                components={meal.components}
                householdSize={householdSize}
                pantryIngredients={pantryIngredients}
                onToggleAvailability={handleToggleAvailability}
                togglingIds={togglingIngredientIds}
                availability={availability}
              />
            </CardContent>
            <CardFooter className="gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setIsDetailModalOpen(true)}>
                View
              </Button>
              <Button variant="outline" size="sm" onClick={() => setIsRegenerateModalOpen(true)}>
                Swap
              </Button>
            </CardFooter>
          </CollapsibleContent>
        </Card>
      </Collapsible>
      <MealDetailModal
        meal={meal}
        householdSize={householdSize}
        open={isDetailModalOpen}
        onOpenChange={setIsDetailModalOpen}
        pantryIngredients={pantryIngredients}
      />
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
