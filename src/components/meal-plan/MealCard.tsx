'use client'

import { useState, useMemo, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { MoreHorizontal, NotebookPen, Repeat, X } from 'lucide-react'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Body } from '@/components/ui/typography'
import { useRouter } from 'next/navigation'
import { StatusSelect, type MealStatus } from './StatusSelect'
import { MealSelectorModal } from './MealSelectorModal'
import { MealDetailModal, type MealDetailModalHandle } from './MealDetailModal'
import { PantryDeductionModal } from './PantryDeductionModal'
import { AvailabilityIndicator, computeMealAvailability } from './AvailabilityIndicator'
import { NoteEditor } from './NoteEditor'
import { MealImageCard, mealImageTitleWidth, mealTintHue } from './MealImageCard'
import { MealRatingPrompt, RatingBadge, MealRatingInline } from './MealRating'
import type { EntryRating, MealData, PantryIngredient, PantryItemFull } from './types'
import type { MealType } from '@/generated/prisma/enums'
import { useDropPlanSuggestions } from '@/hooks/use-drop-plan-suggestions'
import { useMealImageFields } from '@/hooks/use-meal-image'
import { track } from '@/lib/analytics'
import { cn } from '@/lib/utils'

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
  /** The pantry was already charged for this entry — see `PlanEntry.pantryDeducted`. */
  pantryDeducted?: boolean
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
  pantryDeducted = false,
}: MealCardProps) {
  const router = useRouter()
  const dropSuggestionCache = useDropPlanSuggestions(planId)
  const tCard = useTranslations('meal-plan.card')
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
  // Set when a deduction confirmed on this card went through, so a revert and
  // re-complete before `router.refresh()` lands does not preview it again.
  const [chargedHere, setChargedHere] = useState(false)
  const isPantryCharged = pantryDeducted || chargedHere

  const effectiveServings = servingOverride ?? householdSize
  const hasServingOverride = servingOverride !== null && servingOverride !== householdSize

  const detailModalRef = useRef<MealDetailModalHandle>(null)
  // The tint follows an image generated from the detail modal, not only the payload.
  const tintMeal = useMealImageFields(meal)

  // The PATCH that repoints this entry also nulls its cached `preparationTips`
  // and resets its `servingOverride` server-side (the swap branch of
  // `/api/meal-plans/[id]/entries/[entryId]`). Neither lives in the tree
  // `router.refresh()` re-renders: `servingOverride` is this card's own state,
  // and the detail modal below is rendered unconditionally, so its
  // `useMealTips` instance survives the swap still holding the previous meal's
  // tips. Without resetting both here the card keeps showing the old serving
  // count and the modal replays the old meal's tips until a full reload
  // (HON-682).
  //
  // Only when the meal actually changed, mirroring the server: search and "my
  // recipes" browse list the dish already on the entry (only `/regenerate`
  // filters it out), so a selection is not necessarily a swap, and the server
  // resets nothing on a re-send of the same `mealId` (HON-703). Resetting
  // anyway would drop a deliberate serving override the row still holds and
  // throw away tips the row still holds, with `router.refresh()` unable to
  // reseed either — the card would disagree with the database for the rest of
  // the session.
  //
  // Deliberately not `key={meal?.id}` on the modal: remounting would also
  // discard whatever is unsaved in `NoteEditor`'s local draft, and a swap does
  // not clear the entry's note server-side, so that text is still wanted.
  //
  // Shared with the empty-slot callsite below, which renders no detail modal —
  // the optional call no-ops there — but does run the same server-side reset
  // when a meal is assigned, so the override still has to be dropped. `meal`
  // is null there, so the change test always passes, which is right: filling
  // an empty slot is always a change.
  const handleSwapComplete = useCallback(
    (selectedMealId: string) => {
      if (selectedMealId !== meal?.id) {
        setServingOverride(null)
        detailModalRef.current?.resetForSwap()
        dropSuggestionCache()
      }
      router.refresh()
    },
    [router, dropSuggestionCache, meal?.id],
  )

  const availability = useMemo(() => {
    if (!meal) return null
    return computeMealAvailability(meal, pantryIngredients)
  }, [meal, pantryIngredients])

  // Hide availability badge for completed/skipped meals (ingredient status no longer relevant)
  const shouldShowAvailability = status !== 'completed' && status !== 'skipped'

  // A completed entry records what was cooked and what the pantry was charged
  // for, so the API refuses to repoint it (409, HON-633) — offering Swap here
  // would only produce an error. Skipped entries stay swappable: nothing was
  // charged for them, and "actually, let's cook something" is a real path.
  const canSwapMeal = status !== 'completed'

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
        throw new Error(tCard('statusUpdateFailed'))
      }

      const data: { pantryDeducted?: boolean } = await response.json()
      return { newStatus, deductPantry, pantryDeducted: data.pantryDeducted === true }
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
      toast.error(tCard('statusUpdateFailed'))
    },
  })

  const clearMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(tCard('clearFailed'))
      }
    },
    onSuccess: () => {
      // Clearing frees this entry's meal to be suggested elsewhere again, so
      // every other card's cached list is now wrong in the other direction.
      dropSuggestionCache()
      router.refresh()
    },
    onError: () => {
      toast.error(tCard('clearFailed'))
    },
  })

  function handleStatusChange(newStatus: MealStatus) {
    if (newStatus === 'completed' && meal) {
      // The server charges an entry at most once — reverting does not restock,
      // and nothing clears the marker (HON-651). Previewing a deduction here
      // would ask the user to confirm a change that never happens, so an
      // already-charged entry completes directly.
      if (isPantryCharged) {
        statusMutation.mutate(
          { newStatus },
          {
            onSuccess: () => {
              setShowRatingPrompt(true)
            },
          },
        )
        return
      }

      // Intercept "completed" status to show deduction modal
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
        onSuccess: ({ pantryDeducted: charged }) => {
          if (charged) setChargedHere(true)
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

  // Note and the menu sit at the right end of the title row; the image ends
  // before them and the title wraps before it (HON-749).
  const hasTrailingActions = !isReadOnly && !isPast

  if (!meal) {
    const canEdit = !isReadOnly && !isPast

    return (
      <>
        <Card className="gap-2 py-2">
          <CardContent className="flex flex-col gap-1.5 px-3 pb-1">
            {note ? (
              <Body variant="muted" className="italic">
                {note}
              </Body>
            ) : (
              <Body variant="caption">{tCard('noMealPlanned')}</Body>
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
                className="w-full"
                onClick={() => setIsSelectorOpen(true)}
              >
                {tCard('addMeal')}
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
            onSwapComplete={handleSwapComplete}
            mode="add"
            pantryIngredients={pantryIngredients}
          />
        )}
      </>
    )
  }

  return (
    <>
      <MealImageCard
        meal={tintMeal ?? meal}
        trailingActions={hasTrailingActions}
        className="gap-2 py-2"
      >
        <CardHeader className="px-3 pb-0">
          <div className="flex items-start justify-between gap-1">
            {/* A native button rather than `Button`: the name wraps, and every
                `Button` size is a fixed height a second line would overflow.
                `min-h-8` holds it to the same 32px floor as the actions beside
                it (docs/DESIGN.md → Spacing, radius, elevation). */}
            <div
              className={cn(
                'min-w-0',
                mealTintHue(tintMeal ?? meal) !== null && mealImageTitleWidth(hasTrailingActions),
              )}
            >
              <Body variant="small" className="font-semibold">
                <button
                  type="button"
                  className="min-h-8 cursor-pointer text-left leading-snug underline-offset-2 hover:underline"
                  onClick={() => setIsDetailModalOpen(true)}
                >
                  {meal.name}
                </button>
              </Body>
            </div>
            {hasTrailingActions && (
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setIsNoteEditing(true)}>
                  <NotebookPen aria-hidden="true" />
                  {tCard('note')}
                </Button>
                {/* Swap and Clear share one trigger: three labelled `sm` buttons
                    leave a 390px card too little room for the meal name. */}
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={tCard('moreActions')}>
                      <MoreHorizontal aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canSwapMeal && (
                      <DropdownMenuItem onSelect={() => setIsRegenerateModalOpen(true)}>
                        <Repeat aria-hidden="true" />
                        {tCard('swap')}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={handleClear} disabled={isClearing}>
                      <X aria-hidden="true" />
                      {tCard('clear')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {!isPast && shouldShowAvailability && availability && (
              <AvailabilityIndicator availability={availability} />
            )}
            {hasServingOverride && (
              <Badge variant="secondary">{tCard('servings', { count: effectiveServings })}</Badge>
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
            <Body variant="muted" className="italic">
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
            <Body variant="caption">{tCard('rate')}</Body>
            <MealRatingInline
              planId={planId}
              entryId={entryId}
              rating={rating}
              onRatingChange={setRating}
            />
          </CardContent>
        )}
      </MealImageCard>
      <MealDetailModal
        ref={detailModalRef}
        meal={meal}
        householdSize={householdSize}
        status={status}
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
        onSwapComplete={handleSwapComplete}
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
