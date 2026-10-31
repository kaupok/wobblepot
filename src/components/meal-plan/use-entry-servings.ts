'use client'

import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { apiFetch } from '@/lib/api'

interface UseEntryServingsOptions {
  planId: string
  entryId: string
  householdServings: number
  servingOverride?: number | null
  open: boolean
  onServingOverrideChange?: (servingOverride: number | null) => void
  /** Drops the cook view's steps, which are priced for the old count. */
  cancelSteps: () => void
}

/**
 * The cook view's serving count for one entry: the count on screen, and the
 * PATCH that changes it, with an optimistic update and a rollback.
 */
export function useEntryServings({
  planId,
  entryId,
  householdServings,
  servingOverride,
  open,
  onServingOverrideChange,
  cancelSteps,
}: UseEntryServingsOptions) {
  const tServing = useTranslations('meal-plan.serving')
  const [localServings, setLocalServings] = useState(servingOverride ?? householdServings)

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

  return { localServings, setLocalServings, handleServingsChange }
}
