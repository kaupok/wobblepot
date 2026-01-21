'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { useRouter } from 'next/navigation'
import type { MealStatus } from '@/components/meal-plan/StatusSelect'
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
  initialTips?: string | null
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
  initialTips = null,
}: TodayMealCardProps) {
  const router = useRouter()
  const [status, setStatus] = useState<MealStatus>(initialStatus)
  const [isUpdating, setIsUpdating] = useState(false)
  const [isRegenerateModalOpen, setIsRegenerateModalOpen] = useState(false)
  const [isDeductionModalOpen, setIsDeductionModalOpen] = useState(false)
  const [togglingIngredientIds, setTogglingIngredientIds] = useState<Set<string>>(new Set())
  const [tips, setTips] = useState<string | null>(initialTips)
  const [isLoadingTips, setIsLoadingTips] = useState(false)
  const [tipsError, setTipsError] = useState<string | null>(null)
  const [isTipsExpanded, setIsTipsExpanded] = useState(false)
  const [isChangingStatus, setIsChangingStatus] = useState(false)

  // Sync tips state when initialTips prop changes (e.g., after meal swap)
  useEffect(() => {
    setTips(initialTips)
    setIsTipsExpanded(false)
    setTipsError(null)
  }, [initialTips])

  const availability = useMemo(() => {
    if (!meal) return null
    return computeMealAvailability(meal, pantryIngredients)
  }, [meal, pantryIngredients])

  // Hide availability badge for completed/skipped meals (ingredient status no longer relevant)
  const shouldShowAvailability = status !== 'completed' && status !== 'skipped'
  const isFinished = status === 'completed' || status === 'skipped'

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

  async function handleSkipped() {
    const success = await updateStatus('skipped')
    if (success) {
      setIsChangingStatus(false)
    }
  }

  async function handleReset() {
    const success = await updateStatus('planned')
    if (success) {
      setIsChangingStatus(false)
      // Refresh to update ingredient availability indicators
      router.refresh()
    }
  }

  function handleCancelStatusChange() {
    setIsChangingStatus(false)
  }

  async function handleDeductionConfirm() {
    const success = await updateStatus('completed', true)
    if (success) {
      setIsDeductionModalOpen(false)
      setIsChangingStatus(false)
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
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                {typeStyle.label}
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

  // Show simplified card for finished meals (unless changing status)
  const showSimplifiedView = isFinished && !isChangingStatus

  return (
    <>
      <Card className={status === 'skipped' ? 'opacity-60' : undefined}>
        {/* TOP SECTION: Status prompt, title, nutrition, time, badges + Swap button */}
        <CardHeader className={showSimplifiedView ? 'pb-4' : 'pb-0'}>
          {/* Status prompt at top for planned meals when time has passed */}
          {showStatusPrompt && status === 'planned' && (
            <div className="mb-3">
              <MealStatusPrompt
                mealName={meal.name}
                onMadeIt={handleMadeIt}
                onSkipped={handleSkipped}
                disabled={isUpdating}
              />
            </div>
          )}
          {/* Status change prompt when editing finished meal status */}
          {isChangingStatus && (
            <div className="mb-3">
              <MealStatusPrompt
                mealName={meal.name}
                onMadeIt={handleMadeIt}
                onSkipped={handleSkipped}
                onCancel={handleCancelStatusChange}
                onReset={handleReset}
                disabled={isUpdating}
                currentStatus={status}
              />
            </div>
          )}
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                  {typeStyle.label}
                </span>
                {status === 'completed' && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    ✓ Made it
                  </span>
                )}
                {status === 'skipped' && (
                  <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                    Skipped
                  </span>
                )}
                {isFinished && !isChangingStatus && (
                  <button
                    type="button"
                    onClick={() => setIsChangingStatus(true)}
                    className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
                  >
                    Change
                  </button>
                )}
              </div>
              <CardTitle className="text-base leading-tight font-semibold">{meal.name}</CardTitle>
              {!showSimplifiedView && (
                <>
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
                </>
              )}
            </div>
            {/* Swap button in top-right - hide for finished meals */}
            {!showSimplifiedView && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsRegenerateModalOpen(true)}
                className="shrink-0"
              >
                Swap
              </Button>
            )}
          </div>
        </CardHeader>

        {/* BOTTOM SECTION: Two-column layout (Ingredients | Preparation) */}
        {!showSimplifiedView && (
          <div className="grid grid-cols-1 gap-4 px-6 pt-4 pb-6 md:grid-cols-2">
            {/* Left column: Ingredients */}
            <div className="flex flex-col gap-4">
              <IngredientList
                components={meal.components}
                householdSize={householdSize}
                pantryIngredients={pantryIngredients}
                onToggleAvailability={isFinished ? undefined : handleToggleAvailability}
                togglingIds={togglingIngredientIds}
                availability={shouldShowAvailability ? availability : null}
                hideAvailability={isFinished}
              />
            </div>

            {/* Right column: Preparation */}
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
          </div>
        )}
      </Card>
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
