'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'

interface UseIngredientAvailabilityOptions {
  onRefresh: () => void
}

export function useIngredientAvailability({ onRefresh }: UseIngredientAvailabilityOptions) {
  const [optimisticOverrides, setOptimisticOverrides] = useState<Map<string, boolean>>(new Map())

  const toggleMutation = useMutation({
    mutationFn: async ({ ingredientId, hasIt }: { ingredientId: string; hasIt: boolean }) => {
      if (hasIt) {
        const response = await fetch('/api/pantry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ingredientId }),
        })

        if (!response.ok) {
          const data = await response.json()
          if (response.status !== 409) {
            throw new Error(data.error || 'Failed to add to pantry')
          }
        }
      } else {
        const response = await fetch(`/api/pantry/by-ingredient/${ingredientId}`, {
          method: 'DELETE',
        })

        if (!response.ok && response.status !== 404) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to remove from pantry')
        }
      }
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
