'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { useRouter } from 'next/navigation'
import type { MealStatus } from '@/components/meal-plan/StatusSelect'
import { MealSelectorModal } from '@/components/meal-plan/MealSelectorModal'
import { PantryDeductionModal } from '@/components/meal-plan/PantryDeductionModal'
import { MealDetail } from '@/components/meal-plan/MealDetail'
import { NoteEditor } from '@/components/meal-plan/NoteEditor'
import { MealStatusPrompt } from './MealStatusPrompt'
import { useIngredientAvailability } from '@/hooks/use-ingredient-availability'
import { useMealTips } from '@/hooks/use-meal-tips'
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
  initialNote?: string | null
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
  initialNote = null,
}: TodayMealCardProps) {
  const router = useRouter()
  const [status, setStatus] = useState<MealStatus>(initialStatus)
  const [note, setNote] = useState<string | null>(initialNote)
  const [isUpdating, setIsUpdating] = useState(false)
  const [isRegenerateModalOpen, setIsRegenerateModalOpen] = useState(false)
  const [isDeductionModalOpen, setIsDeductionModalOpen] = useState(false)
  const [isChangingStatus, setIsChangingStatus] = useState(false)

  const { togglingIngredientIds, handleToggleAvailability } = useIngredientAvailability({
    onRefresh: () => router.refresh(),
  })
  const {
    tips,
    isLoadingTips,
    tipsError,
    isTipsExpanded,
    fetchTips,
    handleHowToPrepare,
    hideTips,
    setTips,
    setIsTipsExpanded,
    setTipsError,
  } = useMealTips({ planId, entryId, initialTips })

  // Sync tips state when initialTips prop changes (e.g., after meal swap)
  useEffect(() => {
    setTips(initialTips)
    setIsTipsExpanded(false)
    setTipsError(null)
  }, [initialTips, setTips, setIsTipsExpanded, setTipsError])

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

  const typeStyle = mealTypeStyles[mealType]
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)

  if (!meal) {
    return (
      <>
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                {typeStyle.label}
              </div>
              <Button variant="outline" size="sm" onClick={() => setIsSelectorOpen(true)}>
                Add meal
              </Button>
            </div>
            {note ? (
              <Body variant="muted" className="italic">
                {note}
              </Body>
            ) : (
              <Body variant="muted">No meal planned</Body>
            )}
            <NoteEditor planId={planId} entryId={entryId} note={note} onNoteChange={setNote} />
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

  // Show simplified card for finished meals (unless changing status)
  const showSimplifiedView = isFinished && !isChangingStatus

  return (
    <>
      <Card className={status === 'skipped' ? 'opacity-60' : undefined}>
        {/* TOP SECTION: Status prompt, title, swap button */}
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
          <div className="flex items-center justify-between">
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
            {/* Swap button on meal type row - hide for finished meals */}
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
          <CardTitle className="text-base leading-tight font-semibold">{meal.name}</CardTitle>
          {/* Note section - shown for both simplified and full view */}
          {!showSimplifiedView && (
            <NoteEditor planId={planId} entryId={entryId} note={note} onNoteChange={setNote} />
          )}
          {/* Display-only note for simplified view */}
          {showSimplifiedView && note && (
            <Body variant="muted" className="italic">
              {note}
            </Body>
          )}
        </CardHeader>

        {/* BOTTOM SECTION: Meal detail (nutrition, ingredients, prep tips) */}
        {!showSimplifiedView && (
          <div className="px-6 pt-4 pb-6">
            <MealDetail
              meal={meal}
              householdSize={householdSize}
              pantryIngredients={pantryIngredients}
              onToggleAvailability={isFinished ? undefined : handleToggleAvailability}
              togglingIds={togglingIngredientIds}
              hideAvailability={isFinished}
              hideAvailabilityBadge={isFinished}
              tips={tips}
              isLoadingTips={isLoadingTips}
              tipsError={tipsError}
              onRetryTips={fetchTips}
              isTipsExpanded={isTipsExpanded}
              onHowToPrepare={handleHowToPrepare}
              onHideTips={hideTips}
            />
          </div>
        )}
      </Card>
      <MealSelectorModal
        open={isRegenerateModalOpen}
        onOpenChange={setIsRegenerateModalOpen}
        planId={planId}
        entryId={entryId}
        mealType={mealType}
        householdSize={householdSize}
        currentMealName={meal?.name}
        onSwapComplete={() => router.refresh()}
        mode="swap"
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
