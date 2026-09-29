'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'
import { ApiError, apiFetch } from '@/lib/api'

interface UseIngredientAvailabilityOptions {
  onRefresh: () => void
}

export function useIngredientAvailability({ onRefresh }: UseIngredientAvailabilityOptions) {
  const [optimisticOverrides, setOptimisticOverrides] = useState<Map<string, boolean>>(new Map())

  const toggleMutation = useMutation({
    mutationFn: async ({ ingredientId, hasIt }: { ingredientId: string; hasIt: boolean }) => {
      // Each direction tolerates the status that means "already that way": a
      // 409 when the item is already in the pantry, a 404 when it is already
      // gone. Either way the pantry now matches what the user asked for.
      const toleratedStatus = hasIt ? 409 : 404
      const request = hasIt
        ? apiFetch<unknown>(
            '/api/pantry',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ingredientId }),
            },
            'Failed to add to pantry',
          )
        : apiFetch<void>(
            `/api/pantry/by-ingredient/${ingredientId}`,
            { method: 'DELETE' },
            'Failed to remove from pantry',
          )
      await request.catch((err: unknown) => {
        if (err instanceof ApiError && err.status === toleratedStatus) return
        throw err
      })
    },
    onMutate: async ({ ingredientId, hasIt }) => {
      // Snapshot previous override for this ingredient
      const previousValue = optimisticOverrides.get(ingredientId)

      // Optimistic update: show new state immediately
      setOptimisticOverrides((prev) => new Map(prev).set(ingredientId, hasIt))

      return { ingredientId, previousValue }
    },
    onError: (_err, _vars, context) => {
      // Revert optimistic update on error
      if (context) {
        setOptimisticOverrides((prev) => {
          const next = new Map(prev)
          if (context.previousValue !== undefined) {
            next.set(context.ingredientId, context.previousValue)
          } else {
            next.delete(context.ingredientId)
          }
          return next
        })
      }
      toast.error(_err instanceof Error ? _err.message : 'Failed to update pantry')
    },
    onSettled: (_data, error) => {
      // Only refresh on success
      if (!error) {
        onRefresh()
      }
    },
  })

  // Derive toggling IDs from pending mutations
  const togglingIngredientIds = new Set<string>()
  if (toggleMutation.isPending && toggleMutation.variables) {
    togglingIngredientIds.add(toggleMutation.variables.ingredientId)
  }

  const handleToggleAvailability = useCallback(
    (ingredientId: string, hasIt: boolean) => {
      // Prevent double-clicks while already toggling this ingredient
      if (toggleMutation.isPending && toggleMutation.variables?.ingredientId === ingredientId)
        return

      toggleMutation.mutate({ ingredientId, hasIt })
    },
    [toggleMutation],
  )

  return { togglingIngredientIds, optimisticOverrides, handleToggleAvailability }
}
