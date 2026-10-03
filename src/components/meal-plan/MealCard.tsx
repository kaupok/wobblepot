'use client'

import { useState, useMemo, useCallback, useEffect, useId, useRef } from 'react'
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
import { MealSelectorModal } from './MealSelectorModal'
import { MealDetailModal, type MealDetailModalHandle } from './MealDetailModal'
import { PantryDeductionModal } from './PantryDeductionModal'
import {
  AvailabilityIndicator,
  computeMealAvailability,
  hasPantryData,
} from './AvailabilityIndicator'
import { NoteEditor, type NoteEditorHandle } from './NoteEditor'
import { StickyNote } from './StickyNote'
import { MEAL_IMAGE_BADGE_ROW_WIDTH, MealImageCard, mealImageTitleWidth } from './MealImageCard'
import { MealRatingPrompt, RatingBadge, MealRatingInline } from './MealRating'
import { MealTypeBadge } from './MealTypeBadge'
import { noteScatter } from './note-placement'
import { useNoteDrag } from './use-note-drag'
import { MyRecipeIcon } from './MyRecipeBadge'
import { ProteinBadge } from './ProteinBadge'
import type {
  EntryRating,
  MealData,
  MealStatus,
  PantryIngredient,
  PantryItemFull,
  StructuredTips,
} from './types'
import type { MealType } from '@/generated/prisma/enums'
import { useDropPlanSuggestions } from '@/hooks/use-drop-plan-suggestions'
import { useMealImageFields } from '@/hooks/use-meal-image'
import { useEntryStatus } from './use-entry-status'
import { cn } from '@/lib/utils'

/**
 * What a card click leaves to itself: every control. The saved note's slip is
 * a button, and a drag of it stops its own click (`useNoteDrag`).
 */
const CARD_CLICK_IGNORE =
  'button, a, input, textarea, select, label, [role="menuitem"], [role="option"]'

interface MealCardProps {
  entryId: string
  planId: string
  meal: MealData | null
  mealType: MealType
  status: MealStatus
  rating?: EntryRating | null
  householdSize: number
  isReadOnly?: boolean
  pantryIngredients?: PantryIngredient[]
  pantryItems?: PantryItemFull[]
  note?: string | null
  /** The note slip's saved place on the card (`NotePosition`); both null for the default (HON-975). */
  noteX?: number | null
  noteY?: number | null
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
  pantryIngredients = [],
  pantryItems = [],
  note: initialNote,
  noteX = null,
  noteY = null,
  servingOverride: initialServingOverride,
  pantryDeducted = false,
  preparationTips = null,
}: MealCardProps) {
  const router = useRouter()
  const dropSuggestionCache = useDropPlanSuggestions(planId)
  const tCard = useTranslations('meal-plan.card')
  const [rating, setRating] = useState<EntryRating | null>(initialRating ?? null)
  const [showRatingPrompt, setShowRatingPrompt] = useState(false)
  const [note, setNote] = useState<string | null>(initialNote ?? null)
  const [servingOverride, setServingOverride] = useState<number | null>(
    initialServingOverride ?? null,
  )
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [isRegenerateModalOpen, setIsRegenerateModalOpen] = useState(false)
  const [isNoteEditing, setIsNoteEditing] = useState(false)
  // Set when Note is chosen from the menu, read once as the menu closes.
  const noteRequestedRef = useRef(false)
  const noteEditorRef = useRef<NoteEditorHandle>(null)

  const effectiveServings = servingOverride ?? householdSize
  const hasServingOverride = servingOverride !== null && servingOverride !== householdSize

  const detailModalRef = useRef<MealDetailModalHandle>(null)
  // The meal name opens the cook view, and is where focus comes back to once
  // the completion flow it can start is over (CLAUDE.md → Focus management).
  const mealNameButtonRef = useRef<HTMLButtonElement>(null)
  const mealNameId = useId()
  // The tint follows an image generated from the detail modal, not only the payload.
  const tintMeal = useMealImageFields(meal)

  const {
    status,
    isUpdating,
    isDeductionModalOpen,
    setIsDeductionModalOpen,
    handleStatusChange,
    handleDeductionConfirm,
  } = useEntryStatus({
    planId,
    entryId,
    meal,
    initialStatus,
    pantryDeducted,
    source: 'meal_card',
    // The server dropped the entry's cached tips on the way out of
    // `completed`; the cook view's copy has to go with them.
    onLeaveCompleted: () => detailModalRef.current?.dropTips(),
    onCompleted: () => setShowRatingPrompt(true),
  })

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

  // The note's slip lies at its own offset and tilt, or where the household
  // dragged it; the hook owns the drag, the clamp and the save (HON-975).
  const firstRowRef = useRef<HTMLDivElement>(null)
  const noteHintId = useId()
  const noteSlipScatter = noteScatter(entryId)
  const noteDrag = useNoteDrag({
    planId,
    entryId,
    initialPosition: noteX !== null && noteY !== null ? { x: noteX, y: noteY } : null,
    firstRowRef,
    menuRef: moreActionsTriggerRef,
    tilt: noteSlipScatter.tilt,
    hintId: noteHintId,
  })
  const notePlacement = { scatter: noteSlipScatter, position: noteDrag.position }
  // Clearing the note clears its place on the server; a new note starts at
  // the default place.
  function handleNoteChange(next: string | null) {
    setNote(next)
    if (next === null) noteDrag.reset()
  }

  function focusAddMealOnClose(event: Event) {
    event.preventDefault()
    addMealButtonRef.current?.focus()
  }

  function focusMoreActionsOnClose(event: Event) {
    event.preventDefault()
    moreActionsTriggerRef.current?.focus()
  }

  // The textarea unmounts when the editor closes, which drops focus to the
  // page body. Return it to whatever opened the editor: the saved note, or the
  // menu trigger, where Note was chosen (and the fallback when a cleared note
  // leaves nothing in the row). Only from the body: a save closes the editor
  // when its request returns, and the user may have moved on by then.
  const noteOpenerRef = useRef<'menu' | 'note' | null>(null)
  function handleNoteEditingChange(editing: boolean) {
    // The editor only asks to open from its saved note; Note in the menu sets
    // `isNoteEditing` itself.
    if (editing) noteOpenerRef.current = 'note'
    setIsNoteEditing(editing)
  }
  useEffect(() => {
    const opener = noteOpenerRef.current
    if (isNoteEditing || !opener) return
    noteOpenerRef.current = null
    if (document.activeElement && document.activeElement !== document.body) return
    if (opener === 'note' && noteEditorRef.current?.focus()) return
    moreActionsTriggerRef.current?.focus()
  }, [isNoteEditing])

  // The deduction dialog opens from state too. It is reached from the cook
  // view's "Done cooking", which has closed by then, so focus comes back to
  // the meal's name, which opened the view.
  function focusMealNameOnClose(event: Event) {
    event.preventDefault()
    mealNameButtonRef.current?.focus()
  }

  // A click anywhere on the card opens the cook view, as the name does
  // (HON-1010). A pointer shortcut only: the name stays the card's keyboard
  // target and accessible name, so the card takes no role, tab stop or keys.
  // Skipped for a click on a control (the name opens the view itself), in the
  // open note editor, and for a click that ends a text selection. React bubbles
  // events out of portals along its own tree, so a click in the ⋯ menu
  // reaches this handler too; that is outside the card's DOM, which the first check catches. The menu is not modal, so a
  // press outside it closes it and still clicks the card: that press only
  // closes the menu.
  const pressClosesMenuRef = useRef(false)
  function handleCardPointerDown() {
    pressClosesMenuRef.current =
      moreActionsTriggerRef.current?.getAttribute('aria-expanded') === 'true'
  }
  function handleCardClick(event: React.MouseEvent<HTMLDivElement>) {
    if (pressClosesMenuRef.current) return
    const target = event.target
    if (!(target instanceof Element) || !event.currentTarget.contains(target)) return
    if (target.closest(CARD_CLICK_IGNORE)) return
    // The open editor's slip belongs to the editor. A read-only card's slip is
    // part of the card.
    if (isNoteEditing && target.closest('[data-slot="meal-image-overlay"] *')) return
    if (window.getSelection()?.toString()) return
    // The press left focus on the page body, and the cook view hands focus
    // back to whatever had it as it opened. Give it the name, as a click on
    // the name would. After a pointer press this shows no focus ring.
    mealNameButtonRef.current?.focus({ preventScroll: true })
    setIsDetailModalOpen(true)
  }

  const isClearing = clearMutation.isPending

  // The menu sits at the right end of the first row; the image ends before
  // it and the title wraps before the image (HON-749).
  const hasTrailingActions = !isReadOnly

  if (!meal) {
    const canEdit = !isReadOnly

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
        interactive
        onPointerDownCapture={handleCardPointerDown}
        onClick={handleCardClick}
        // The head is every row from the slot badge down to the badges; the
        // plate runs its height. The rows below it — the rating prompt
        // and the inline thumbs — run across the width, so they are the
        // card's children and sit on the plain tint below the plate (HON-755,
        // HON-927). A planned card has none, and its plate runs the card's
        // full height. The note is not a row: it lies over the head's
        // bottom-right corner as a slip, so it doesn't change the card's
        // shape (HON-974), at its own offset and tilt or wherever the
        // household dragged it (HON-975).
        head={
          <CardHeader className="px-4 pt-1 pb-1">
            {/* First row: the slot label, with the menu at the right end. The
                name has the next row to itself, still capped before the image
                (`mealImageTitleWidth`). The badges are capped like the badge
                row below: on a short card the note's slip rises into this
                row, so they wrap before it. */}
            <div ref={firstRowRef} className="flex min-h-8 items-center justify-between gap-1">
              <div
                className={cn('flex flex-wrap items-center gap-1.5', MEAL_IMAGE_BADGE_ROW_WIDTH)}
              >
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
                      // after `NoteEditor` has focused its textarea, and on a
                      // pointer pick it has already pulled focus back into the
                      // closing menu by then (HON-946). When Note was chosen,
                      // focus the textarea here instead: the menu's unmount is
                      // the last thing to move focus.
                      onCloseAutoFocus={(event) => {
                        if (noteRequestedRef.current) {
                          event.preventDefault()
                          noteRequestedRef.current = false
                          noteEditorRef.current?.focus()
                        }
                      }}
                    >
                      <DropdownMenuItem
                        onSelect={() => {
                          noteRequestedRef.current = true
                          noteOpenerRef.current = 'menu'
                          setIsNoteEditing(true)
                        }}
                      >
                        <NotebookPen aria-hidden="true" />
                        {tCard('note')}
                      </DropdownMenuItem>
                      {/* "Done cooking" can complete today's or a future
                          day's meal, so a completion here needs its own way
                          back. Past meals have their own page (HON-1018). */}
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
                The button lies over the name rather than around it: a button
                always lays out as an inline-block, so an own recipe's icon after
                one could not follow the name's last word. Here the visible text
                and the icon are one inline run, joined by a no-break space so
                the icon wraps with that word (HON-973), and the button takes its
                name from the text. The icon is positioned and later in the DOM,
                so it stacks over the button and keeps its own hover and focus.
                The whole card opens the view on a click too, so the name
                underlines on a hover anywhere on it, and the card draws the
                name's focus ring around itself (`card-target`, HON-1010).
                The description shares the name's column, so it too stays off
                the plate; it is hidden below `md`, where that column is a third
                of a phone card and prose in it would run a dozen lines. */}
            <div className={cn('flex min-w-0 flex-col', mealImageTitleWidth(hasTrailingActions))}>
              <div className="relative flex min-h-8 w-fit items-center">
                <Heading variant="section" as="h3">
                  <button
                    ref={mealNameButtonRef}
                    type="button"
                    data-slot="card-target"
                    aria-labelledby={mealNameId}
                    className="absolute inset-0 cursor-pointer outline-none"
                    onClick={() => setIsDetailModalOpen(true)}
                  />
                  <span
                    id={mealNameId}
                    aria-hidden="true"
                    className="underline-offset-2 group-hover/card:underline"
                  >
                    {meal.name}
                  </span>
                  {meal.isCustom && (
                    <>
                      {'\u00a0'}
                      <MyRecipeIcon />
                    </>
                  )}
                </Heading>
              </div>
              {meal.description && (
                <div className="hidden md:line-clamp-2">
                  <Body variant="muted">{meal.description}</Body>
                </div>
              )}
            </div>
            {/* Capped when the note's slip lies beside it, so a second badge
                wraps instead of running under the slip. */}
            <div className={cn('flex flex-wrap items-center gap-1', MEAL_IMAGE_BADGE_ROW_WIDTH)}>
              {shouldShowAvailability && availability && (
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
        overlay={
          !isReadOnly
            ? // Rendered only when there is a note to show or edit: an empty
              // controlled editor renders nothing anyway.
              (!!note || isNoteEditing) && (
                <>
                  <NoteEditor
                    ref={noteEditorRef}
                    planId={planId}
                    entryId={entryId}
                    note={note}
                    onNoteChange={handleNoteChange}
                    compact
                    clamped
                    isEditing={isNoteEditing}
                    onEditingChange={handleNoteEditingChange}
                    slipProps={noteDrag.slipProps}
                  />
                  <span id={noteHintId} hidden>
                    {noteDrag.hint}
                  </span>
                </>
              )
            : note && (
                <StickyNote>
                  <div className="line-clamp-2">
                    <Body variant="paragraph">{note}</Body>
                  </div>
                </StickyNote>
              )
        }
        overlayWide={isNoteEditing}
        overlayPlacement={notePlacement}
      >
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
        onNoteChange={handleNoteChange}
        servingOverride={servingOverride}
        onServingOverrideChange={setServingOverride}
        initialTips={preparationTips}
        // Steps generate on open only for a meal somebody is about to cook.
        generateOnOpen={status === 'planned' && !isReadOnly}
        // A read-only card cannot be marked cooked.
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
