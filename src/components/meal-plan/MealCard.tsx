'use client'

import { useState, useMemo, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api'
import { MoreHorizontal, NotebookPen, Repeat, Undo2, X } from 'lucide-react'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Body, Heading } from '@/components/ui/typography'
import { useRouter } from 'next/navigation'
import { StatusSelect, type MealStatus } from './StatusSelect'
import { MealSelectorModal } from './MealSelectorModal'
import { MealDetailModal, type MealDetailModalHandle } from './MealDetailModal'
import { PantryDeductionModal } from './PantryDeductionModal'
import {
  AvailabilityIndicator,
  computeMealAvailability,
  hasPantryData,
} from './AvailabilityIndicator'
import { NoteEditor } from './NoteEditor'
import { StickyNote } from './StickyNote'
import { MealImageCard, mealImageTitleWidth } from './MealImageCard'
import { MealRatingPrompt, RatingBadge, MealRatingInline } from './MealRating'
import { MealTypeBadge } from './MealTypeBadge'
import { ProteinBadge } from './ProteinBadge'
import type {
  EntryRating,
  MealData,
  PantryIngredient,
  PantryItemFull,
  StructuredTips,
} from './types'
import type { MealType } from '@/generated/prisma/enums'
import { useDropPlanSuggestions } from '@/hooks/use-drop-plan-suggestions'
import { useMealImageFields } from '@/hooks/use-meal-image'
import { track, type Source } from '@/lib/analytics'
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
  /** The entry's cached preparation tips — see `PlanEntry.preparationTips`. */
  preparationTips?: StructuredTips | null
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
  preparationTips = null,
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
  // Set when Note is chosen from the menu, read once as the menu closes.
  const noteRequestedRef = useRef(false)
  // Set when a deduction confirmed on this card went through, so a revert and
  // re-complete before `router.refresh()` lands does not preview it again.
  const [chargedHere, setChargedHere] = useState(false)
  const isPantryCharged = pantryDeducted || chargedHere

  const effectiveServings = servingOverride ?? householdSize
  const hasServingOverride = servingOverride !== null && servingOverride !== householdSize

  const detailModalRef = useRef<MealDetailModalHandle>(null)
  // The meal name opens the cook view, and is where focus comes back to once
  // the completion flow it can start is over (CLAUDE.md → Focus management).
  const mealNameButtonRef = useRef<HTMLButtonElement>(null)
  // Where a completion started, read when the deduction is confirmed: the
  // status select on a past card, or "Done cooking" in the cook view.
  const completionSourceRef = useRef<Source>('meal_card')
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

  // A pantry holding only staples says nothing yet, so the card claims nothing
  // is missing, as the meal picker does (HON-824).
  const availability = useMemo(() => {
    if (!meal || !hasPantryData(pantryIngredients)) return null
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
      source?: Source
    }) => {
      const data = await apiFetch<{ pantryDeducted?: boolean }>(
        `/api/meal-plans/${planId}/entries/${entryId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus, deductPantry }),
        },
      )
      return { newStatus, deductPantry, pantryDeducted: data.pantryDeducted === true }
    },
    onMutate: async ({ newStatus }) => {
      const previousStatus = status
      // Optimistic update
      setStatus(newStatus)
      return { previousStatus }
    },
    onSuccess: ({ newStatus }, { source = 'meal_card' }, context) => {
      // The server dropped the entry's cached tips on the way out of
      // `completed`; the cook view's copy has to go with them.
      if (context?.previousStatus === 'completed' && newStatus !== 'completed') {
        detailModalRef.current?.dropTips()
      }

      // Fire status-transition analytics from `onSuccess` so we don't track
      // optimistic updates that the server later rejected (the optimistic
      // state is reverted in `onError`). `meal` is non-null on this code
      // path because the empty-slot case returns early above.
      if (!meal) return
      if (newStatus === 'completed') {
        void track('meal_plan:meal_completed', {
          plan_id: planId,
          meal_id: meal.id,
          source,
        })
      } else if (newStatus === 'skipped') {
        void track('meal_plan:meal_skipped', {
          plan_id: planId,
          meal_id: meal.id,
          source,
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
    mutationFn: () =>
      apiFetch<{ success: true }>(`/api/meal-plans/${planId}/entries/${entryId}`, {
        method: 'DELETE',
      }),
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

  function handleStatusChange(newStatus: MealStatus, source: Source = 'meal_card') {
    if (newStatus === 'completed' && meal) {
      completionSourceRef.current = source
      // The server charges an entry at most once — reverting does not restock,
      // and nothing clears the marker (HON-651). Previewing a deduction here
      // would ask the user to confirm a change that never happens, so an
      // already-charged entry completes directly.
      if (isPantryCharged) {
        statusMutation.mutate(
          { newStatus, source },
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
    statusMutation.mutate({ newStatus, source })
  }

  async function handleDeductionConfirm() {
    statusMutation.mutate(
      { newStatus: 'completed', deductPantry: true, source: completionSourceRef.current },
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

  // Both selectors open from state, with no `DialogTrigger`, and a modal Radix
  // dialog hands focus back only to its trigger, so it would land on the page
  // body. Return it to the control that opened the selector: "Add meal", or,
  // for Swap, the menu trigger, since the menu item is gone by then (HON-804).
  const addMealButtonRef = useRef<HTMLButtonElement>(null)
  const moreActionsTriggerRef = useRef<HTMLButtonElement>(null)

  function focusAddMealOnClose(event: Event) {
    event.preventDefault()
    addMealButtonRef.current?.focus()
  }

  function focusMoreActionsOnClose(event: Event) {
    event.preventDefault()
    moreActionsTriggerRef.current?.focus()
  }

  // The deduction dialog opens from state too. Whichever way it was reached
  // — the status select or the cook view's "Done cooking" — focus comes back
  // to the meal's name, which is still on the card either way.
  function focusMealNameOnClose(event: Event) {
    event.preventDefault()
    mealNameButtonRef.current?.focus()
  }

  const isUpdating = statusMutation.isPending
  const isClearing = clearMutation.isPending

  // The menu sits at the right end of the first row; the image ends before
  // it and the title wraps before the image (HON-749).
  const hasTrailingActions = !isReadOnly && !isPast

  if (!meal) {
    const canEdit = !isReadOnly && !isPast

    return (
      <>
        <Card size="sm">
          <CardContent className="flex flex-col gap-1.5 px-4 pt-1 pb-2">
            <MealTypeBadge mealType={mealType} />
            {/* The note is the slip, once: the editor's own slip when the slot
                can be edited, a read-only one when it cannot. */}
            {!note && <Body variant="caption">{tCard('noMealPlanned')}</Body>}
            {canEdit ? (
              <NoteEditor
                planId={planId}
                entryId={entryId}
                note={note}
                onNoteChange={setNote}
                compact
              />
            ) : (
              note && (
                <StickyNote>
                  <Body variant="paragraph">{note}</Body>
                </StickyNote>
              )
            )}
          </CardContent>
          {canEdit && (
            <CardFooter className="px-4 pt-0">
              <Button
                ref={addMealButtonRef}
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
            onCloseAutoFocus={focusAddMealOnClose}
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
        size="sm"
        // The head is every row from the slot badge down to the badges; the
        // plate runs its height. The rows below it — the note, a past card's
        // status control and rating prompt — run across the width, so they are
        // the card's children and sit on the plain tint below the plate
        // (HON-755, HON-927). A planned card without a note has none, and its
        // plate runs the card's full height.
        head={
          <CardHeader className="px-4 pt-1 pb-1">
            {/* First row: the slot label, with the menu at the right end. The
                name has the next row to itself, still capped before the image
                (`mealImageTitleWidth`). */}
            <div className="flex min-h-8 items-center justify-between gap-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <MealTypeBadge mealType={mealType} />
                <ProteinBadge proteinType={meal.primaryProteinType} />
              </div>
              {hasTrailingActions && (
                <div className="flex shrink-0 items-center gap-1">
                  {/* Note, Swap and Clear share one trigger: the title row keeps
                      its width for the meal name. */}
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        ref={moreActionsTriggerRef}
                        variant="ghost"
                        size="icon-sm"
                        aria-label={tCard('moreActions', { name: meal.name })}
                      >
                        <MoreHorizontal aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      // Radix returns focus to the trigger as the menu closes,
                      // after `NoteEditor` has focused its textarea. When Note
                      // was chosen, leave focus where the editor put it.
                      onCloseAutoFocus={(event) => {
                        if (noteRequestedRef.current) {
                          event.preventDefault()
                          noteRequestedRef.current = false
                        }
                      }}
                    >
                      <DropdownMenuItem
                        onSelect={() => {
                          noteRequestedRef.current = true
                          setIsNoteEditing(true)
                        }}
                      >
                        <NotebookPen aria-hidden="true" />
                        {tCard('note')}
                      </DropdownMenuItem>
                      {/* "Done cooking" can complete today's or a future
                          day's meal, and the status select is only on past
                          cards, so a completion here needs its own way back. */}
                      {status === 'completed' && (
                        <DropdownMenuItem
                          onSelect={() => handleStatusChange('planned')}
                          disabled={isUpdating}
                        >
                          <Undo2 aria-hidden="true" />
                          {tCard('notCookedYet')}
                        </DropdownMenuItem>
                      )}
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
            {/* The name at Section, as on the recipe library card, one level
                under the day's `h2`. A native button rather than `Button`: the
                name wraps, and every `Button` size is a fixed height a second
                line would overflow. `min-h-8` holds it to the same 32px floor as
                the menu above it (docs/DESIGN.md → Spacing, radius, elevation).
                The description shares the name's column, so it too stays off
                the plate; it is hidden below `md`, where that column is a third
                of a phone card and prose in it would run a dozen lines. */}
            <div className={cn('flex min-w-0 flex-col', mealImageTitleWidth(hasTrailingActions))}>
              <Heading variant="section" as="h3">
                <button
                  ref={mealNameButtonRef}
                  type="button"
                  className="min-h-8 cursor-pointer text-left leading-snug underline-offset-2 hover:underline"
                  onClick={() => setIsDetailModalOpen(true)}
                >
                  {meal.name}
                </button>
              </Heading>
              {meal.description && (
                <div className="hidden md:line-clamp-2">
                  <Body variant="muted">{meal.description}</Body>
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
          </CardHeader>
        }
      >
        {/* The note, editable on a planned card. Rendered only when there is
            one to show or edit: the row is what ends the plate mid-card. */}
        {!isReadOnly && !isPast && (note != null || isNoteEditing) && (
          <CardContent className="px-4 pb-2">
            <NoteEditor
              planId={planId}
              entryId={entryId}
              note={note}
              onNoteChange={setNote}
              compact
              isEditing={isNoteEditing}
              onEditingChange={setIsNoteEditing}
            />
          </CardContent>
        )}
        {(isReadOnly || isPast) && note && (
          <CardContent className="px-4 pb-2">
            <StickyNote>
              <Body variant="paragraph">{note}</Body>
            </StickyNote>
          </CardContent>
        )}
        {!isReadOnly && isPast && (
          <CardContent className="px-4 pb-2">
            <StatusSelect value={status} onChange={handleStatusChange} disabled={isUpdating} />
          </CardContent>
        )}
        {status === 'completed' && showRatingPrompt && (
          <CardContent className="px-4 pb-2">
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
          <CardContent className="flex items-center gap-1.5 px-4 pb-2">
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
        initialTips={preparationTips}
        // Steps generate on open only for a meal somebody is about to cook.
        generateOnOpen={status === 'planned' && !isPast && !isReadOnly}
        // Cooking yesterday's meal late is allowed: past is fine, read-only is not.
        onDoneCooking={
          status === 'planned' && !isReadOnly
            ? () => handleStatusChange('completed', 'cook_view')
            : undefined
        }
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
        onCloseAutoFocus={focusMoreActionsOnClose}
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
        onCloseAutoFocus={focusMealNameOnClose}
      />
    </>
  )
}
