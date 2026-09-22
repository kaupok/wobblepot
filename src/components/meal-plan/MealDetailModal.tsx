'use client'

import { useState, useCallback, useImperativeHandle } from 'react'
import type { Ref } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useIngredientAvailability } from '@/hooks/use-ingredient-availability'
import { useMealTips } from '@/hooks/use-meal-tips'
import { useMealImage } from '@/hooks/use-meal-image'
import { MealDetail } from './MealDetail'
import { MealImage } from './MealImage'
import { NoteEditor } from './NoteEditor'
import type { MealStatus } from './StatusSelect'
import type { MealData, PantryIngredient } from './types'

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
    hideTips,
    cancelTips,
  } = useMealTips({ planId, entryId })
  const { status: imageStatus, imageUrl, imageHue, cancelImage } = useMealImage({ meal, open })

  // Sync local state when prop changes
  const effectiveServings = servingOverride ?? householdSize
  if (localServings !== effectiveServings && !open) {
    setLocalServings(effectiveServings)
  }

  const handleServingsChange = useCallback(
    async (newServings: number | null): Promise<boolean> => {
      const previousServings = localServings

      // Optimistic update
      const displayServings = newServings ?? householdSize
      setLocalServings(displayServings)

      try {
        const response = await fetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ servingOverride: newServings }),
        })

        if (!response.ok) {
          setLocalServings(previousServings)
          toast.error(tServing('updateFailed'))
          return false
        }

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
        return true
      } catch {
        setLocalServings(previousServings)
        toast.error(tServing('updateFailed'))
        return false
      }
    },
    [planId, entryId, householdSize, localServings, onServingOverrideChange, tServing, cancelTips],
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
      <DialogContent className="max-h-dialog overflow-y-auto sm:max-w-md md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{meal.name}</DialogTitle>
          <DialogDescription className="sr-only">
            {tDetail('ariaDetailsFor', { mealName: meal.name })}
          </DialogDescription>
        </DialogHeader>
        {/* Note section at top of modal */}
        <div className="border-muted mb-2 border-b pb-3">
          <NoteEditor
            planId={planId}
            entryId={entryId}
            note={note ?? null}
            onNoteChange={onNoteChange}
          />
        </div>
        <MealDetail
          meal={meal}
          image={
            <MealImage
              mealName={meal.name}
              status={imageStatus}
              imageUrl={imageUrl}
              imageHue={imageHue}
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
          isLoadingTips={isLoadingTips}
          tipsError={tipsError}
          onRetryTips={fetchTips}
          isTipsExpanded={isTipsExpanded}
          onHowToPrepare={handleHowToPrepare}
          onHideTips={hideTips}
        />
      </DialogContent>
    </Dialog>
  )
}
