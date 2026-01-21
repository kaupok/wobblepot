'use client'

import { useState, useMemo, useCallback } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { useRouter } from 'next/navigation'
import type { MealStatus } from '@/components/meal-plan/StatusSelect'
import { MealDetailModal } from '@/components/meal-plan/MealDetailModal'
import { RegenerateModal } from '@/components/meal-plan/RegenerateModal'
import { PantryDeductionModal } from '@/components/meal-plan/PantryDeductionModal'
import { MealLibraryModal } from '@/components/meal-plan/MealLibraryModal'
import { PreparationTips } from './PreparationTips'
import { MealStatusPrompt } from './MealStatusPrompt'
import { computeMealAvailability } from '@/components/meal-plan/AvailabilityIndicator'
import { IngredientList } from '@/components/meal-plan/IngredientList'
import { NutritionSummary } from '@/components/meal-plan/NutritionSummary'
import type { MealData, PantryIngredient, PantryItemFull } from '@/components/meal-plan/types'
import type { MealType } from '@/generated/prisma/enums'

const mealTypeStyles: Record<MealType, { label: string }> = {
  breakfast: {
    label: 'Breakfast',
  },
  lunch: {
    label: 'Lunch',
  },
  dinner: {
    label: 'Dinner',
  },
}

interface TodayMealCardProps {
  entryId: string
  planId: string
  meal: MealData | null
  mealType: MealType
  status: MealStatus
  householdSize: number
  pantryIngredients: PantryIngredient[]
  pantryItems: PantryItemFull[]
  showStatusPrompt?: boolean
}

export function TodayMealCard({
  entryId,
  planId,
  meal,
  mealType,
  status: initialStatus,
  householdSize,
  pantryIngredients,
  pantryItems,
  showStatusPrompt = false,
}: TodayMealCardProps) {
  const router = useRouter()
  const [status, setStatus] = useState<MealStatus>(initialStatus)
  const [isUpdating, setIsUpdating] = useState(false)
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [isRegenerateModalOpen, setIsRegenerateModalOpen] = useState(false)
  const [isDeductionModalOpen, setIsDeductionModalOpen] = useState(false)
  const [togglingIngredientIds, setTogglingIngredientIds] = useState<Set<string>>(new Set())
  const [tips, setTips] = useState<string | null>(null)
  const [isLoadingTips, setIsLoadingTips] = useState(false)
  const [tipsError, setTipsError] = useState<string | null>(null)
  const [isTipsExpanded, setIsTipsExpanded] = useState(false)

  const availability = useMemo(() => {
    if (!meal) return null
    return computeMealAvailability(meal, pantryIngredients)
  }, [meal, pantryIngredients])

  // Hide availability badge for completed/skipped meals (ingredient status no longer relevant)
  const shouldShowAvailability = status !== 'completed' && status !== 'skipped'

  async function updateStatus(newStatus: MealStatus, deductPantry: boolean = false) {
    const previousStatus = status
    // Optimistic update
    setStatus(newStatus)
    setIsUpdating(true)

    try {
      const response = await fetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, deductPantry }),
      })

      if (!response.ok) {
        // Revert on error
        setStatus(previousStatus)
        toast.error('Failed to update status. Please try again.')
        return false
      }
      return true
    } catch {
      // Revert on error
      setStatus(previousStatus)
      toast.error('Failed to update status. Please try again.')
      return false
    } finally {
      setIsUpdating(false)
    }
  }

  function handleMadeIt() {
    // Show deduction modal before marking as completed
    if (meal) {
      setIsDeductionModalOpen(true)
    }
  }

  function handleSkipped() {
    updateStatus('skipped')
  }

  async function handleDeductionConfirm() {
    const success = await updateStatus('completed', true)
    if (success) {
      setIsDeductionModalOpen(false)
      // Refresh to update pantry data
      router.refresh()
    }
  }

  const handleToggleAvailability = useCallback(
    async (ingredientId: string, hasIt: boolean) => {
      setTogglingIngredientIds((prev) => new Set(prev).add(ingredientId))

      try {
        if (hasIt) {
          // Add to pantry
          const response = await fetch('/api/pantry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ingredientId }),
          })

          if (!response.ok) {
            const data = await response.json()
            // 409 means already in pantry - treat as success
            if (response.status !== 409) {
              throw new Error(data.error || 'Failed to add to pantry')
            }
          }
        } else {
          // Remove from pantry
          const response = await fetch(`/api/pantry/by-ingredient/${ingredientId}`, {
            method: 'DELETE',
          })

          if (!response.ok && response.status !== 404) {
            const data = await response.json()
            throw new Error(data.error || 'Failed to remove from pantry')
          }
        }

        // Refresh to update pantry data across all components
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

  const typeStyle = mealTypeStyles[mealType]
  const [isLibraryOpen, setIsLibraryOpen] = useState(false)

  if (!meal) {
    return (
      <>
        <Card>
          <CardHeader className="pb-2">
            <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
              {typeStyle.label}
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
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-1">
              <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                {typeStyle.label}
              </div>
              <CardTitle className="text-base leading-tight font-semibold">{meal.name}</CardTitle>
              {meal.nutrition && <NutritionSummary nutrition={meal.nutrition} compact />}
            </div>
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
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pb-3">
          <IngredientList
            components={meal.components}
            householdSize={householdSize}
            pantryIngredients={pantryIngredients}
            onToggleAvailability={handleToggleAvailability}
            togglingIds={togglingIngredientIds}
            availability={shouldShowAvailability ? availability : null}
          />
          {showStatusPrompt && status === 'planned' && (
            <MealStatusPrompt
              mealName={meal.name}
              onMadeIt={handleMadeIt}
              onSkipped={handleSkipped}
              disabled={isUpdating}
            />
          )}
          {isTipsExpanded && (
            <PreparationTips
              tips={tips}
              isLoading={isLoadingTips}
              error={tipsError}
              onRetry={fetchTips}
            />
          )}
        </CardContent>
        <CardFooter className="gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={handleHowToPrepare}>
            {tips && isTipsExpanded ? 'Hide tips' : 'How to prepare'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setIsDetailModalOpen(true)}>
            View
          </Button>
          <Button variant="outline" size="sm" onClick={() => setIsRegenerateModalOpen(true)}>
            Swap
          </Button>
        </CardFooter>
      </Card>
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
        currentMealName={meal?.name}
        onSwapComplete={() => router.refresh()}
      />
      <PantryDeductionModal
        open={isDeductionModalOpen}
        onOpenChange={setIsDeductionModalOpen}
        mealName={meal.name}
        components={meal.components}
        householdSize={householdSize}
        pantryItems={pantryItems}
        onConfirm={handleDeductionConfirm}
        isLoading={isUpdating}
      />
    </>
  )
}
