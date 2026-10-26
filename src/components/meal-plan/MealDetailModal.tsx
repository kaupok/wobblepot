'use client'

import { useState, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import type { Ref } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { MoreHorizontal, NotebookPen } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useIngredientAvailability } from '@/hooks/use-ingredient-availability'
import { useMealSteps } from '@/hooks/use-meal-steps'
import { useCookQuestion } from '@/hooks/use-cook-question'
import { sameSubject, type CookQuestionSubject } from '@/lib/ai/cook-question-subject'
import { useMealImage } from '@/hooks/use-meal-image'
import { CookViewDialog } from './CookViewDialog'
import { MealDetail } from './MealDetail'
import { ConflictBadges } from './ConflictBadge'
import { NoteEditor, type NoteEditorHandle } from './NoteEditor'
import type { EntryChange, MealData, MealStatus, PantryIngredient, PreparationSteps } from './types'
import type { PreferenceConflict } from '@/lib/meal-planning/preference-conflicts'

export interface MealDetailModalHandle {
  /**
   * Drop the client state the server invalidated when this entry was repointed
   * at a different meal. Called by `MealCard`'s `onSwapComplete` (HON-682).
   */
  resetForSwap: () => void
  /**
   * Drop the tips the server just nulled when this entry left `completed`
   * (the entry PATCH route). Called by `MealCard` on that status change.
   */
  dropSteps: () => void
}

interface MealDetailModalProps {
  meal: MealData
  householdServings: number
  /** Status of the plan entry; a completed entry shows its servings read-only */
  status?: MealStatus
  open: boolean
  onOpenChange: (open: boolean) => void
  pantryIngredients?: PantryIngredient[]
  /** The entry's plan and id. Unused, and may be omitted, with `readOnly`. */
  planId?: string
  entryId?: string
  note?: string | null
  onNoteChange?: (note: string | null) => void
  servingOverride?: number | null
  onServingOverrideChange?: (servingOverride: number | null) => void
  /**
   * The entry's cached tips, as the server loaded them. Seeds the steps on
   * first render so a cached entry needs no request. Read once: a later
   * `router.refresh()` cannot bring back tips a swap or serving change dropped.
   */
  initialSteps?: PreparationSteps | null
  /**
   * The food preferences the meal breaks, as badges under its name, so the
   * household sees them before cooking (HON-1126). The caller passes them for
   * a planned entry only.
   */
  conflicts?: readonly PreferenceConflict[]
  /** The entry's own ingredient changes (HON-1243); editable while `planned`. */
  changes?: EntryChange[]
  /** The "Adjust recipe" instruction the steps follow (HON-1244). */
  adjustmentNote?: string | null
  /**
   * Generate the steps when the view opens, rather than behind "How to
   * prepare" — for a planned entry somebody is about to cook (HON-933).
   */
  generateOnOpen?: boolean
  /**
   * "Done cooking" was chosen. Called once the view has closed, so whatever
   * the caller opens next never stacks on it. Omit to hide the button.
   */
  onDoneCooking?: () => void
  /**
   * The view as a demonstration, outside any plan: the signed-out home page.
   * Nothing writes and nothing is fetched: no note, no serving control, no
   * pantry toggles, no Ask and no "Done cooking". The steps are `initialSteps`,
   * shown at once as for a planned entry; ticking them stays on the page.
   */
  readOnly?: boolean
  ref?: Ref<MealDetailModalHandle>
}

/** "How to prepare" for a read-only view: the steps are already there. */
function noop() {}

export function MealDetailModal({
  meal,
  householdServings,
  status,
  open,
  onOpenChange,
  pantryIngredients = [],
  planId = '',
  entryId = '',
  note,
  onNoteChange,
  servingOverride,
  onServingOverrideChange,
  initialSteps = null,
  conflicts = [],
  changes,
  adjustmentNote = null,
  generateOnOpen = false,
  onDoneCooking,
  readOnly = false,
  ref,
}: MealDetailModalProps) {
  const router = useRouter()
  const tDetail = useTranslations('meal-plan.detail')
  const tServing = useTranslations('meal-plan.serving')
  const tNote = useTranslations('meal-plan.noteEditor')
  const [localServings, setLocalServings] = useState(servingOverride ?? householdServings)
  const { togglingIngredientIds, optimisticOverrides, handleToggleAvailability } =
    useIngredientAvailability({
      onRefresh: () => router.refresh(),
    })
  const {
    steps,
    isLoadingSteps,
    stepsError,
    isStepsExpanded,
    fetchSteps,
    handleHowToPrepare,
    cancelSteps,
  } = useMealSteps({ planId, entryId, initialSteps })
  const { status: imageStatus, imageUrl, imageHue, cancelImage } = useMealImage({ meal, open })

  // A planned entry's steps are just there (HON-933): generate them as the
  // view opens, unless they are cached, already on their way, or failed. A
  // failure stays until the user taps Retry, so reopening never loops on it.
  // Tips dropped while the view is open — a serving change — come back for
  // the new count the same way.
  const needsSteps = generateOnOpen && !steps && !stepsError
  useEffect(() => {
    if (open && needsSteps && !isLoadingSteps) void fetchSteps()
  }, [open, needsSteps, isLoadingSteps, fetchSteps])

  // The step (HON-969) or the item in "You'll need" (HON-983) whose question
  // panel is open, one at a time across both. Opening or closing a panel drops
  // the answer on screen, so the hook is reset each time. A question in flight
  // for steps that were replaced cannot show: the next panel to open resets it
  // first.
  const [questionSubject, setQuestionSubject] = useState<CookQuestionSubject | null>(null)
  const {
    ask: askQuestion,
    active: activeQuestion,
    previous: previousQuestion,
    isPending: isQuestionPending,
    isStreaming: isQuestionStreaming,
    error: questionError,
    retry: retryQuestion,
    reset: resetQuestion,
  } = useCookQuestion({ planId, entryId, mealId: meal.id })
  const handleOpenQuestion = useCallback(
    (subject: CookQuestionSubject) => {
      resetQuestion()
      setQuestionSubject(subject)
    },
    [resetQuestion],
  )
  const handleCloseQuestion = useCallback(() => {
    resetQuestion()
    setQuestionSubject(null)
  }, [resetQuestion])

  // Which steps the cook has ticked off. Lives here because `MealCard` keeps
  // this component mounted, so the progress survives closing and reopening
  // the view mid-recipe; not persisted, so a reload starts afresh. Tied to
  // the tips object it was ticked against: new steps (a serving change, a
  // swap) start unticked.
  const [doneSteps, setDoneSteps] = useState<ReadonlySet<number>>(() => new Set())
  const [doneStepsFor, setDoneStepsFor] = useState(steps)
  if (doneStepsFor !== steps) {
    setDoneStepsFor(steps)
    setDoneSteps(new Set())
    // An open question panel points at a step or an item of the old lists.
    setQuestionSubject(null)
  }
  const handleToggleStep = useCallback(
    (index: number) => {
      // Ticking the step whose panel is open closes the panel (HON-982): the
      // cook has moved on. Focus stays on the toggle, which is outside the
      // panel, so it is not handed to the Ask button as Close does.
      if (!doneSteps.has(index) && sameSubject(questionSubject, { kind: 'step', index })) {
        resetQuestion()
        setQuestionSubject(null)
      }
      setDoneSteps((prev) => {
        const next = new Set(prev)
        if (!next.delete(index)) next.add(index)
        return next
      })
    },
    [doneSteps, questionSubject, resetQuestion],
  )

  // Set by "Done cooking", read as the view finishes closing: the caller's
  // next dialog (the pantry deduction) opens only once this one is gone.
  const doneCookingRef = useRef(false)
  const handleDoneCooking = useCallback(() => {
    doneCookingRef.current = true
    onOpenChange(false)
  }, [onOpenChange])

  const contentRef = useRef<HTMLDivElement>(null)

  // The note opens from the title row's ⋯ menu or from the saved slip
  // (HON-966). Controlled here, so `NoteEditor` shows no "Add note" button of
  // its own.
  const [isEditingNote, setIsEditingNote] = useState(false)
  // `MealCard` keeps this component mounted, so an editor left open would
  // otherwise greet the next opening. Closing the view drops the draft, as it
  // did when the editor's own state unmounted with the panel.
  if (!open && isEditingNote) setIsEditingNote(false)
  const noteEditorRef = useRef<NoteEditorHandle>(null)
  const moreActionsTriggerRef = useRef<HTMLButtonElement>(null)
  // Set when the menu item is chosen, read once as the menu closes.
  const noteRequestedRef = useRef(false)
  // The textarea unmounts when the editor closes, and focus falls out of it.
  // Return it to what opened the editor: the saved slip, or the ⋯ trigger
  // (also the fallback when a cleared note leaves no slip). Only when focus
  // fell to the body or the panel, where Radix's focus trap catches it: a
  // save closes the editor when its request returns, and the user may have
  // moved on by then.
  const noteOpenerRef = useRef<'menu' | 'note' | null>(null)
  const handleNoteEditingChange = useCallback((editing: boolean) => {
    // The editor only asks to open from its saved slip; the menu item sets
    // `isEditingNote` itself.
    if (editing) noteOpenerRef.current = 'note'
    setIsEditingNote(editing)
  }, [])
  useEffect(() => {
    if (isEditingNote) return
    // The menu focuses the editor only once its exit animation ends, and a
    // save can close the editor sooner. With no textarea left, the editor's
    // focus falls back to the slip; leave the menu to return focus to its
    // trigger (HON-1108).
    noteRequestedRef.current = false
    const opener = noteOpenerRef.current
    if (!opener) return
    noteOpenerRef.current = null
    const focused = document.activeElement
    if (focused && focused !== document.body && focused !== contentRef.current) return
    if (opener === 'note' && noteEditorRef.current?.focus()) return
    moreActionsTriggerRef.current?.focus()
  }, [isEditingNote])
  // Sync local state when prop changes
  const effectiveServings = servingOverride ?? householdServings
  if (localServings !== effectiveServings && !open) {
    setLocalServings(effectiveServings)
  }

  const servingsMutation = useMutation({
    mutationFn: (newServings: number | null) =>
      apiFetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servingOverride: newServings }),
      }),
    onMutate: (newServings) => {
      const previousServings = localServings
      // Optimistic update
      setLocalServings(newServings ?? householdServings)
      return { previousServings }
    },
    onSuccess: (_data, newServings) => {
      // Notify parent of change
      onServingOverrideChange?.(newServings)

      // The PATCH just nulled this entry's cached `preparationTips`, because
      // the prompt scales by the serving count (HON-681). This component is
      // rendered unconditionally by `MealCard`, so it never unmounts and the
      // hook's `steps` survives a close and reopen — and `handleHowToPrepare`
      // short-circuits on a non-null `steps`, so without dropping it here the
      // panel keeps showing pan sizes for the old count and never re-POSTs.
      //
      // `cancelSteps` rather than clearing the state, because a generation
      // started before this change is still running and would otherwise
      // resolve into the state we just emptied.
      cancelSteps()
    },
    onError: (_err, _newServings, context) => {
      if (context) setLocalServings(context.previousServings)
      toast.error(tServing('updateFailed'))
    },
  })

  const { mutateAsync: updateServings } = servingsMutation
  // `ServingControl` awaits a boolean rather than the mutation's result, so
  // the rejection is already handled by `onError` and only the outcome crosses.
  const handleServingsChange = useCallback(
    (newServings: number | null): Promise<boolean> =>
      updateServings(newServings).then(
        () => true,
        () => false,
      ),
    [updateServings],
  )

  // A swap repoints this entry at a different meal, and the same PATCH nulls
  // the entry's cached `preparationTips` and resets its `servingOverride`
  // server-side. `MealCard` renders this component unconditionally — `open` is
  // a prop, not a mount guard — so the `useMealSteps` instance above survives
  // the swap holding the previous meal's tips, and `entryId` does not change,
  // so nothing remounts it. `router.refresh()` re-renders the server tree but
  // cannot reach either piece of client state (HON-682).
  //
  // `cancelSteps` rather than clearing the state: a generation started before
  // the swap runs for up to 45s and would otherwise resolve into the state we
  // just emptied, after which `handleHowToPrepare` short-circuits on it and
  // never re-POSTs for the meal now on screen.
  useImperativeHandle(
    ref,
    () => ({
      resetForSwap: () => {
        cancelSteps()
        setDoneSteps(new Set())
        // Same trap for the image: its request is keyed by the old meal's id,
        // so it can never show under the new one, but it should not keep
        // running for a meal that is no longer on this entry.
        cancelImage()
        // The sync above only runs while the modal is closed, which is the
        // usual case — the Swap control lives on the card behind this dialog.
        // Resetting here keeps the count right if a swap ever lands while it
        // is open, since the server reverted the entry to the household servings.
        setLocalServings(householdServings)
      },
      // Leaving `completed` nulls the entry's cached tips server-side: they
      // may be priced for a member count the household no longer has, since
      // membership changes skip completed entries. The copy seeded from
      // `initialSteps` would otherwise survive here, and generate-on-open
      // would never ask again.
      dropSteps: cancelSteps,
    }),
    [cancelSteps, cancelImage, householdServings],
  )

  return (
    <CookViewDialog
      meal={meal}
      open={open}
      onOpenChange={onOpenChange}
      image={{ status: imageStatus, imageUrl, imageHue }}
      contentRef={contentRef}
      // Under the name, so the household reads them before cooking (HON-1126).
      belowTitle={
        conflicts.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-2">
            <ConflictBadges conflicts={conflicts} size="lg" />
          </div>
        ) : null
      }
      // After "Done cooking", hand over to the caller once focus is back on
      // the card, so whatever it opens next never stacks on this view.
      onClosed={() => {
        if (doneCookingRef.current) {
          doneCookingRef.current = false
          onDoneCooking?.()
        }
      }}
    >
      {({ image, title }) => (
        <MealDetail
          meal={meal}
          image={image}
          title={title}
          // Actions on the meal sit on its title row (docs/DESIGN.md). `icon-lg`,
          // not the cards' `icon-sm`: every target in the cook view is 44px.
          // `modal={false}` so the editor can take focus once the menu closes
          // (HON-946).
          titleActions={
            readOnly ? undefined : (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    ref={moreActionsTriggerRef}
                    variant="ghost"
                    size="icon-lg"
                    aria-label={tDetail('moreActions', { name: meal.name })}
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  // Radix returns focus to the trigger as the menu closes, after
                  // `NoteEditor` has focused its textarea (HON-946). When the
                  // note was chosen, focus the textarea here instead: the menu's
                  // unmount is the last thing to move focus.
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
                      setIsEditingNote(true)
                    }}
                  >
                    <NotebookPen aria-hidden="true" />
                    {note ? tNote('editNote') : tNote('addNote')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )
          }
          note={
            readOnly ? undefined : (
              <NoteEditor
                ref={noteEditorRef}
                planId={planId}
                entryId={entryId}
                note={note ?? null}
                onNoteChange={onNoteChange}
                size="lg"
                isEditing={isEditingNote}
                onEditingChange={handleNoteEditingChange}
              />
            )
          }
          householdServings={householdServings}
          status={status}
          servings={localServings}
          onServingsChange={readOnly ? undefined : handleServingsChange}
          pantryIngredients={pantryIngredients}
          onToggleAvailability={readOnly ? undefined : handleToggleAvailability}
          togglingIds={togglingIngredientIds}
          optimisticOverrides={optimisticOverrides}
          steps={steps}
          // Skeletons from the first frame, not once the effect above has
          // started the request: a planned entry never flashes "How to prepare".
          isLoadingSteps={isLoadingSteps || needsSteps}
          stepsError={stepsError}
          onRetrySteps={readOnly ? undefined : fetchSteps}
          isStepsExpanded={generateOnOpen || readOnly || isStepsExpanded}
          onHowToPrepare={readOnly ? noop : handleHowToPrepare}
          doneSteps={doneSteps}
          onToggleStep={handleToggleStep}
          // Questions are for a meal somebody is cooking: the same planned,
          // editable entry that gets "Done cooking".
          cookQuestion={
            onDoneCooking
              ? {
                  openSubject: questionSubject,
                  onOpenSubject: handleOpenQuestion,
                  onClose: handleCloseQuestion,
                  ask: askQuestion,
                  active: activeQuestion,
                  previous: previousQuestion,
                  isPending: isQuestionPending,
                  isStreaming: isQuestionStreaming,
                  error: questionError,
                  onRetry: retryQuestion,
                }
              : undefined
          }
          onDoneCooking={onDoneCooking ? handleDoneCooking : undefined}
          ingredientChanges={
            changes && !readOnly
              ? {
                  planId,
                  entryId,
                  changes,
                  adjustmentNote,
                  // The planned, editable entry that gets "Done cooking".
                  editable: status === 'planned' && !!onDoneCooking,
                  // The write nulled the cached steps, so drop the ones shown;
                  // a planned view regenerates them from the merged list.
                  onChanged: cancelSteps,
                }
              : undefined
          }
        />
      )}
    </CookViewDialog>
  )
}
