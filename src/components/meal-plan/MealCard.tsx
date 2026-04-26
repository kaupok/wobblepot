'use client'

import { useState, useMemo } from 'react'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { useRouter } from 'next/navigation'
import { StatusSelect, type MealStatus } from './StatusSelect'
import { MealSelectorModal } from './MealSelectorModal'
import { MealDetailModal } from './MealDetailModal'
import { PantryDeductionModal } from './PantryDeductionModal'
import { AvailabilityIndicator, computeMealAvailability } from './AvailabilityIndicator'
import { NoteEditor } from './NoteEditor'
import { MealRatingPrompt, RatingBadge, MealRatingInline } from './MealRating'
import type { EntryRating, MealData, PantryIngredient, PantryItemFull } from './types'
import type { MealType } from '@/generated/prisma/enums'
import { track } from '@/lib/analytics'

interface MealCardProps {
  entryId: string
  planId: string
  meal: MealData | null
  mealType: MealType
  status: MealStatus
  rating?: EntryRating | null
  householdSize: number
  isReadOnly?: boolean
  isPast?: boolean
  pantryIngredients?: PantryIngredient[]
  pantryItems?: PantryItemFull[]
  note?: string | null
  servingOverride?: number | null
}

export function MealCard({
  entryId,
  planId,
  meal,
  mealType,
  status: initialStatus,
  rating: initialRating,
  householdSize,
  isReadOnly,
  isPast,
  pantryIngredients = [],
  pantryItems = [],
  note: initialNote,
  servingOverride: initialServingOverride,
}: MealCardProps) {
  const router = useRouter()
  const [status, setStatus] = useState<MealStatus>(initialStatus)
  const [rating, setRating] = useState<EntryRating | null>(initialRating ?? null)
  const [showRatingPrompt, setShowRatingPrompt] = useState(false)
  const [note, setNote] = useState<string | null>(initialNote ?? null)
  const [servingOverride, setServingOverride] = useState<number | null>(
    initialServingOverride ?? null,
  )
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [isRegenerateModalOpen, setIsRegenerateModalOpen] = useState(false)
  const [isDeductionModalOpen, setIsDeductionModalOpen] = useState(false)
  const [isNoteEditing, setIsNoteEditing] = useState(false)

  const effectiveServings = servingOverride ?? householdSize
  const hasServingOverride = servingOverride !== null && servingOverride !== householdSize

  const availability = useMemo(() => {
    if (!meal) return null
    return computeMealAvailability(meal, pantryIngredients)
  }, [meal, pantryIngredients])

  // Hide availability badge for completed/skipped meals (ingredient status no longer relevant)
  const shouldShowAvailability = status !== 'completed' && status !== 'skipped'

  const statusMutation = useMutation({
    mutationFn: async ({
      newStatus,
      deductPantry = false,
    }: {
      newStatus: MealStatus
      deductPantry?: boolean
    }) => {
      const response = await fetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, deductPantry }),
      })

      if (!response.ok) {
        throw new Error('Failed to update status')
      }

      return { newStatus, deductPantry }
    },
    onMutate: async ({ newStatus }) => {
      const previousStatus = status
      // Optimistic update
      setStatus(newStatus)
      return { previousStatus }
    },
    onSuccess: ({ newStatus }) => {
      // Fire status-transition analytics from `onSuccess` so we don't track
      // optimistic updates that the server later rejected (the optimistic
      // state is reverted in `onError`). `meal` is non-null on this code
      // path because the empty-slot case returns early above.
      if (!meal) return
      if (newStatus === 'completed') {
        void track('meal_plan:meal_completed', {
          plan_id: planId,
          meal_id: meal.id,
          source: 'meal_card',
        })
      } else if (newStatus === 'skipped') {
        void track('meal_plan:meal_skipped', {
          plan_id: planId,
          meal_id: meal.id,
          source: 'meal_card',
        })
      }
    },
    onError: (_err, _vars, context) => {
      // Revert on error
      if (context?.previousStatus) {
        setStatus(context.previousStatus)
      }
      toast.error('Failed to update status. Please try again.')
    },
  })

  const clearMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to clear meal')
      }
    },
    onSuccess: () => {
      router.refresh()
    },
    onError: () => {
      toast.error('Failed to clear meal. Please try again.')
    },
  })

  function handleStatusChange(newStatus: MealStatus) {
    // Intercept "completed" status to show deduction modal
    if (newStatus === 'completed' && meal) {
      setIsDeductionModalOpen(true)
      return
    }

    // For other statuses, update directly
    statusMutation.mutate({ newStatus })
  }

  async function handleDeductionConfirm() {
    statusMutation.mutate(
      { newStatus: 'completed', deductPantry: true },
      {
        onSuccess: () => {
          setIsDeductionModalOpen(false)
          setShowRatingPrompt(true)
          // Refresh to update pantry data
          router.refresh()
        },
      },
    )
  }

  function handleClear() {
    clearMutation.mutate()
  }

  const [isSelectorOpen, setIsSelectorOpen] = useState(false)

  const isUpdating = statusMutation.isPending
  const isClearing = clearMutation.isPending

  if (!meal) {
    const canEdit = !isReadOnly && !isPast

    return (
      <>
        <Card className="gap-2 py-2">
          <CardContent className="flex flex-col gap-1.5 px-3 pb-1">
            {note ? (
              <Body variant="caption" className="italic">
                {note}
              </Body>
            ) : (
              <Body variant="caption">No meal planned</Body>
            )}
            {canEdit && (
              <NoteEditor
                planId={planId}
                entryId={entryId}
                note={note}
                onNoteChange={setNote}
                compact
              />
            )}
          </CardContent>
          {canEdit && (
            <CardFooter className="px-3 pt-0">
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-full text-xs"
                onClick={() => setIsSelectorOpen(true)}
              >
                Add meal
              </Button>
            </CardFooter>
          )}
        </Card>
        {canEdit && (
          <MealSelectorModal
            open={isSelectorOpen}
            onOpenChange={setIsSelectorOpen}
            planId={planId}
            entryId={entryId}
            mealType={mealType}
            householdSize={householdSize}
            onSwapComplete={() => router.refresh()}
            mode="add"
            pantryIngredients={pantryIngredients}
          />
        )}
      </>
    )
  }

  return (
    <>
      <Card className="gap-2 py-2">
        <CardHeader className="px-3 pb-0">
          <div className="flex items-start justify-between gap-1">
            <CardTitle className="text-xs leading-tight font-semibold">
              <button
                type="button"
                className="cursor-pointer text-left underline-offset-2 hover:underline"
                onClick={() => setIsDetailModalOpen(true)}
              >
                {meal.name}
              </button>
            </CardTitle>
            {!isReadOnly && !isPast && (
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-xs"
                  onClick={() => setIsNoteEditing(true)}
                >
                  Note
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-xs"
                  onClick={() => setIsRegenerateModalOpen(true)}
                >
                  Swap
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-xs"
                  onClick={handleClear}
                  disabled={isClearing}
                >
                  Clear
                </Button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {!isPast && shouldShowAvailability && availability && (
              <AvailabilityIndicator availability={availability} />
            )}
            {hasServingOverride && (
              <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                {effectiveServings} servings
              </span>
            )}
            {status === 'completed' && rating && !showRatingPrompt && (
              <RatingBadge rating={rating} onClick={() => setShowRatingPrompt(true)} />
            )}
          </div>
          {/* Show note or add note control */}
          {!isReadOnly && !isPast && (
            <NoteEditor
              planId={planId}
              entryId={entryId}
              note={note}
              onNoteChange={setNote}
              compact
              isEditing={isNoteEditing}
              onEditingChange={setIsNoteEditing}
            />
          )}
          {/* Display note for past/readonly slots */}
          {(isReadOnly || isPast) && note && (
            <Body variant="caption" className="italic">
              {note}
            </Body>
          )}
        </CardHeader>
        {!isReadOnly && isPast && (
          <CardContent className="px-3 pb-1">
            <StatusSelect value={status} onChange={handleStatusChange} disabled={isUpdating} />
          </CardContent>
        )}
        {status === 'completed' && showRatingPrompt && (
          <CardContent className="px-3 pb-1">
            <MealRatingPrompt
              planId={planId}
              entryId={entryId}
              onRated={(r) => {
                setRating(r)
                setShowRatingPrompt(false)
              }}
              onDismiss={() => setShowRatingPrompt(false)}
            />
          </CardContent>
        )}
        {status === 'completed' && !rating && !showRatingPrompt && !isReadOnly && (
          <CardContent className="flex items-center gap-1.5 px-3 pb-1">
            <span className="text-muted-foreground text-xs">Rate</span>
            <MealRatingInline
              planId={planId}
              entryId={entryId}
              rating={rating}
              onRatingChange={setRating}
            />
          </CardContent>
        )}
      </Card>
      <MealDetailModal
        meal={meal}
        householdSize={householdSize}
        open={isDetailModalOpen}
        onOpenChange={setIsDetailModalOpen}
        pantryIngredients={pantryIngredients}
        planId={planId}
        entryId={entryId}
        note={note}
        onNoteChange={setNote}
        servingOverride={servingOverride}
        onServingOverrideChange={setServingOverride}
      />
      <MealSelectorModal
        open={isRegenerateModalOpen}
        onOpenChange={setIsRegenerateModalOpen}
        planId={planId}
        entryId={entryId}
        mealType={mealType}
        householdSize={householdSize}
        currentMealName={meal?.name}
        currentMealId={meal?.id}
        onSwapComplete={() => router.refresh()}
        mode="swap"
        pantryIngredients={pantryIngredients}
      />
      <PantryDeductionModal
        open={isDeductionModalOpen}
        onOpenChange={setIsDeductionModalOpen}
        mealName={meal.name}
        components={meal.components}
        householdSize={effectiveServings}
        pantryItems={pantryItems}
        onConfirm={handleDeductionConfirm}
        isLoading={isUpdating}
      />
    </>
  )
}
