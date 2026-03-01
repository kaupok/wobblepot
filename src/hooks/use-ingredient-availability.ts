'use client'

import { useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'

interface UseIngredientAvailabilityOptions {
  onRefresh: () => void
}

export function useIngredientAvailability({ onRefresh }: UseIngredientAvailabilityOptions) {
  const [togglingIngredientIds, setTogglingIngredientIds] = useState<Set<string>>(new Set())
  const [optimisticOverrides, setOptimisticOverrides] = useState<Map<string, boolean>>(new Map())
  const togglingRef = useRef(togglingIngredientIds)
  togglingRef.current = togglingIngredientIds

  const handleToggleAvailability = useCallback(
    async (ingredientId: string, hasIt: boolean) => {
      // Prevent double-clicks while already toggling this ingredient
      if (togglingRef.current.has(ingredientId)) return

      setTogglingIngredientIds((prev) => new Set(prev).add(ingredientId))
      // Optimistic update: show new state immediately
      setOptimisticOverrides((prev) => new Map(prev).set(ingredientId, hasIt))

      try {
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

        onRefresh()
      } catch (error) {
        // Revert optimistic update on error
        setOptimisticOverrides((prev) => {
          const next = new Map(prev)
          next.delete(ingredientId)
          return next
        })
        toast.error(error instanceof Error ? error.message : 'Failed to update pantry')
      } finally {
        setTogglingIngredientIds((prev) => {
          const next = new Set(prev)
          next.delete(ingredientId)
          return next
        })
      }
    },
    [onRefresh],
  )

  return { togglingIngredientIds, optimisticOverrides, handleToggleAvailability }
}
