'use client'

import { useState, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import type { Ref } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Heading } from '@/components/ui/typography'
import { useIngredientAvailability } from '@/hooks/use-ingredient-availability'
import { useMealTips } from '@/hooks/use-meal-tips'
import { useMealImage } from '@/hooks/use-meal-image'
import { useWakeLock } from '@/hooks/use-wake-lock'
import { cn } from '@/lib/utils'
import { MealDetail } from './MealDetail'
import { MealImage } from './MealImage'
import { mealHueStyle, mealTintHue } from './MealImageCard'
import { NoteEditor } from './NoteEditor'
import type { MealStatus } from './StatusSelect'
import type { MealData, PantryIngredient, StructuredTips } from './types'

export interface MealDetailModalHandle {
  /**
   * Drop the client state the server invalidated when this entry was repointed
   * at a different meal. Called by `MealCard`'s `onSwapComplete` (HON-682).
   */
  resetForSwap: () => void
}

interface MealDetailModalProps {
  meal: MealData
  householdSize: number
  /** Status of the plan entry; a completed entry shows its servings read-only */
  status?: MealStatus
  open: boolean
  onOpenChange: (open: boolean) => void
  pantryIngredients?: PantryIngredient[]
  planId: string
  entryId: string
  note?: string | null
  onNoteChange?: (note: string | null) => void
  servingOverride?: number | null
  onServingOverrideChange?: (servingOverride: number | null) => void
  /**
   * The entry's cached tips, as the server loaded them. Seeds the steps on
   * first render so a cached entry needs no request. Read once: a later
   * `router.refresh()` cannot bring back tips a swap or serving change dropped.
   */
  initialTips?: StructuredTips | null
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
  ref?: Ref<MealDetailModalHandle>
}

export function MealDetailModal({
  meal,
  householdSize,
  status,
  open,
  onOpenChange,
  pantryIngredients = [],
  planId,
  entryId,
  note,
  onNoteChange,
  servingOverride,
  onServingOverrideChange,
  initialTips = null,
  generateOnOpen = false,
  onDoneCooking,
  ref,
}: MealDetailModalProps) {
  const router = useRouter()
  const tDetail = useTranslations('meal-plan.detail')
  const tServing = useTranslations('meal-plan.serving')
  const [localServings, setLocalServings] = useState(servingOverride ?? householdSize)
  const { togglingIngredientIds, optimisticOverrides, handleToggleAvailability } =
    useIngredientAvailability({
      onRefresh: () => router.refresh(),
    })
  const {
    tips,
    isLoadingTips,
    tipsError,
    isTipsExpanded,
    fetchTips,
    handleHowToPrepare,
    cancelTips,
  } = useMealTips({ planId, entryId, initialTips })
  const { status: imageStatus, imageUrl, imageHue, cancelImage } = useMealImage({ meal, open })
  // A URL that no longer resolves is an absent image: the hero renders
  // nothing, and the panel drops the tint that came with it (as
  // `MealImageCard` does). Keyed by URL so a new image gets its own chance.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)

  // A planned entry's steps are just there (HON-933): generate them as the
  // view opens, unless they are cached, already on their way, or failed. A
  // failure stays until the user taps Retry, so reopening never loops on it.
  // Tips dropped while the view is open — a serving change — come back for
  // the new count the same way.
  const needsTips = generateOnOpen && !tips && !tipsError
  useEffect(() => {
    if (open && needsTips && !isLoadingTips) void fetchTips()
  }, [open, needsTips, isLoadingTips, fetchTips])

  // Which steps the cook has ticked off. Lives here because `MealCard` keeps
  // this component mounted, so the progress survives closing and reopening
  // the view mid-recipe; not persisted, so a reload starts afresh. Tied to
  // the tips object it was ticked against: new steps (a serving change, a
  // swap) start unticked.
  const [doneSteps, setDoneSteps] = useState<ReadonlySet<number>>(() => new Set())
  const [doneStepsFor, setDoneStepsFor] = useState(tips)
  if (doneStepsFor !== tips) {
    setDoneStepsFor(tips)
    setDoneSteps(new Set())
  }
  const handleToggleStep = useCallback((index: number) => {
    setDoneSteps((prev) => {
      const next = new Set(prev)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }, [])

  // Set by "Done cooking", read as the view finishes closing: the caller's
  // next dialog (the pantry deduction) opens only once this one is gone.
  const doneCookingRef = useRef(false)
  const handleDoneCooking = useCallback(() => {
    doneCookingRef.current = true
    onOpenChange(false)
  }, [onOpenChange])

  // The cook view keeps the screen on while it is open (HON-932).
  useWakeLock(open)
  const contentRef = useRef<HTMLDivElement>(null)
  // The control that opened the view: the card's meal name. The dialog opens
  // from state, with no `DialogTrigger`, so Radix has nothing to return focus
  // to and drops it on `<body>` (CLAUDE.md → Focus management). Captured as
  // the dialog opens, before focus moves into it.
  const returnFocusRef = useRef<HTMLElement | null>(null)

  // The surface follows `MealImageCard`'s rules: a hue tints the whole panel,
  // an image without one gets the `neutral` surface, and no image (or one
  // still generating) leaves the plain background.
  const imageFields = { imageStatus, imageUrl, imageHue }
  const hasImage = imageStatus === 'ready' && !!imageUrl && imageUrl !== brokenUrl
  const hue = hasImage ? mealTintHue(imageFields) : null
  const surface = hasImage ? (hue === null ? 'neutral' : '') : undefined
  const showHero = hasImage || imageStatus === 'generating'

  // The phone's sticky bar: once the title has scrolled up under the bar, the
  // bar takes the tint and shows the meal's name. The bar is hidden from
  // `lg`, where the title sits in a column that never scrolls under it.
  //
  // Observed against the scroll region, not the viewport: the region starts
  // under the panel's safe-area padding, as the bar does, so the -60px top
  // margin (the bar's `h-15`) is the bar's bottom edge on a notched phone too.
  // Against the viewport it would sit a whole inset (59px on an iPhone 14
  // Pro) above the bar, and the bar would tint only once the title was gone.
  const [titleEl, setTitleEl] = useState<HTMLElement | null>(null)
  const [titleHidden, setTitleHidden] = useState(false)
  useEffect(() => {
    if (!titleEl || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => setTitleHidden(!!entry && !entry.isIntersecting),
      {
        root: titleEl.closest('[data-slot="cook-view-scroll"]'),
        rootMargin: '-60px 0px 0px 0px',
      },
    )
    observer.observe(titleEl)
    return () => {
      observer.disconnect()
      setTitleHidden(false)
    }
  }, [titleEl])

  // Sync local state when prop changes
  const effectiveServings = servingOverride ?? householdSize
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
      setLocalServings(newServings ?? householdSize)
      return { previousServings }
    },
    onSuccess: (_data, newServings) => {
      // Notify parent of change
      onServingOverrideChange?.(newServings)

      // The PATCH just nulled this entry's cached `preparationTips`, because
      // the prompt scales by the serving count (HON-681). This component is
      // rendered unconditionally by `MealCard`, so it never unmounts and the
      // hook's `tips` survives a close and reopen — and `handleHowToPrepare`
      // short-circuits on a non-null `tips`, so without dropping it here the
      // panel keeps showing pan sizes for the old count and never re-POSTs.
      //
      // `cancelTips` rather than clearing the state, because a generation
      // started before this change is still running and would otherwise
      // resolve into the state we just emptied.
      cancelTips()
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
  // a prop, not a mount guard — so the `useMealTips` instance above survives
  // the swap holding the previous meal's tips, and `entryId` does not change,
  // so nothing remounts it. `router.refresh()` re-renders the server tree but
  // cannot reach either piece of client state (HON-682).
  //
  // `cancelTips` rather than clearing the state: a generation started before
  // the swap runs for up to 45s and would otherwise resolve into the state we
  // just emptied, after which `handleHowToPrepare` short-circuits on it and
  // never re-POSTs for the meal now on screen.
  useImperativeHandle(
    ref,
    () => ({
      resetForSwap: () => {
        cancelTips()
        setDoneSteps(new Set())
        // Same trap for the image: its request is keyed by the old meal's id,
        // so it can never show under the new one, but it should not keep
        // running for a meal that is no longer on this entry.
        cancelImage()
        // The sync above only runs while the modal is closed, which is the
        // usual case — the Swap control lives on the card behind this dialog.
        // Resetting here keeps the count right if a swap ever lands while it
        // is open, since the server reverted the entry to the household size.
        setLocalServings(householdSize)
      },
    }),
    [cancelTips, cancelImage, householdSize],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        size="fullscreen"
        data-meal-surface={surface}
        // eslint-disable-next-line shadcn/no-inline-styles -- --meal-hue is the one per-meal value (docs/DESIGN.md → Imagery); every colour is derived from it by [data-meal-surface] in globals.css.
        style={hue === null ? undefined : mealHueStyle(hue)}
        // Focus the panel itself, not its first control: the note editor or
        // an ingredient checkbox would pop a keyboard or a focus ring on open.
        // A screen reader announces the dialog by its title and description.
        // Radix still traps focus while it is open.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          returnFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null
          contentRef.current?.focus()
        }}
        // Back to the control that opened it, if it is still on the page.
        // After "Done cooking", hand over to the caller from there: the view
        // has unmounted, so a dialog it opens never stacks on this one, and
        // that dialog's focus scope starts from the card.
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef.current
          returnFocusRef.current = null
          if (target?.isConnected) {
            event.preventDefault()
            target.focus()
          }
          if (doneCookingRef.current) {
            doneCookingRef.current = false
            onDoneCooking?.()
          }
        }}
      >
        <DialogDescription className="sr-only">
          {tDetail('ariaDetailsFor', { mealName: meal.name })}
        </DialogDescription>

        {/* Phone only. Transparent over the hero, where it shows nothing but
            the close button beside it, and lets taps through to the hero.
            Once opaque it takes them itself: a tap on the bar must not land
            on a checkbox or "How to prepare" scrolled out of sight under it.
            The name is a visual repeat of the title, so it stays out of the
            accessibility tree. */}
        <div
          data-testid="cook-view-bar"
          data-title-hidden={titleHidden ? '' : undefined}
          className={cn(
            'absolute inset-x-0 top-0 z-10 flex h-15 items-center pr-16 pl-5 transition-colors duration-200 ease-out md:pl-8 lg:hidden',
            titleHidden ? 'bg-card' : 'pointer-events-none bg-transparent',
          )}
        >
          <p
            aria-hidden="true"
            className={cn(
              'truncate text-lg font-semibold transition-opacity duration-200 ease-out',
              titleHidden ? 'opacity-100' : 'opacity-0',
            )}
          >
            {meal.name}
          </p>
        </div>

        <MealDetail
          meal={meal}
          image={
            showHero ? (
              <MealImage
                mealName={meal.name}
                status={imageStatus}
                imageUrl={imageUrl}
                imageHue={imageHue}
                onError={setBrokenUrl}
              />
            ) : null
          }
          title={
            <DialogTitle asChild>
              <Heading ref={setTitleEl} variant="display">
                {meal.name}
              </Heading>
            </DialogTitle>
          }
          note={
            <NoteEditor
              planId={planId}
              entryId={entryId}
              note={note ?? null}
              onNoteChange={onNoteChange}
              size="lg"
            />
          }
          householdSize={householdSize}
          status={status}
          servings={localServings}
          onServingsChange={handleServingsChange}
          pantryIngredients={pantryIngredients}
          onToggleAvailability={handleToggleAvailability}
          togglingIds={togglingIngredientIds}
          optimisticOverrides={optimisticOverrides}
          tips={tips}
          // Skeletons from the first frame, not once the effect above has
          // started the request: a planned entry never flashes "How to prepare".
          isLoadingTips={isLoadingTips || needsTips}
          tipsError={tipsError}
          onRetryTips={fetchTips}
          isTipsExpanded={generateOnOpen || isTipsExpanded}
          onHowToPrepare={handleHowToPrepare}
          doneSteps={doneSteps}
          onToggleStep={handleToggleStep}
          onDoneCooking={onDoneCooking ? handleDoneCooking : undefined}
        />
      </DialogContent>
    </Dialog>
  )
}
