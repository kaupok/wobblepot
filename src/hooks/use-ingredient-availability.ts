'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { ApiError, apiFetch } from '@/lib/api'

interface UseIngredientAvailabilityOptions {
  onRefresh: () => void
}

export function useIngredientAvailability({ onRefresh }: UseIngredientAvailabilityOptions) {
  const t = useTranslations('pantry.errors')
  const queryClient = useQueryClient()
  const [optimisticOverrides, setOptimisticOverrides] = useState<Map<string, boolean>>(new Map())

  const toggleMutation = useMutation({
    mutationFn: async ({
      ingredientId,
      hasIt,
      isStaple,
    }: {
      ingredientId: string
      hasIt: boolean
      isStaple: boolean
    }) => {
      // A staple row is always in the pantry: unticking marks it ran out (0),
      // which keeps its star and puts it on the shopping list as a restock
      // line; ticking sets it back to have some (null) (HON-1599). A DELETE
      // would drop the star, and the household would lose the staple.
      if (isStaple) {
        await apiFetch<unknown>(`/api/pantry/by-ingredient/${ingredientId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity: hasIt ? null : 0 }),
        })
        return
      }
      // Each direction tolerates the status that means "already that way": a
      // 409 when the item is already in the pantry, a 404 when it is already
      // gone. Either way the pantry now matches what the user asked for.
      const toleratedStatus = hasIt ? 409 : 404
      // Except a row that ran out (HON-1578): it is in the pantry at 0, and
      // Today shows it unticked. "Have it" sets it to "have some", as the
      // pantry page's switch does, or the tick would change nothing.
      const restoreExisting = async (err: ApiError) => {
        const existingId = (err.body as { existingId?: unknown }).existingId
        if (typeof existingId !== 'string') return
        await apiFetch<unknown>(`/api/pantry/${existingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity: null }),
        })
      }
      const request = hasIt
        ? apiFetch<unknown>('/api/pantry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ingredientId }),
          })
        : apiFetch<void>(`/api/pantry/by-ingredient/${ingredientId}`, { method: 'DELETE' })
      await request.catch(async (err: unknown) => {
        if (!(err instanceof ApiError) || err.status !== toleratedStatus) throw err
        if (hasIt) await restoreExisting(err)
      })
    },
    onMutate: async ({ ingredientId, hasIt }) => {
      // Snapshot previous override for this ingredient
      const previousValue = optimisticOverrides.get(ingredientId)

      // Optimistic update: show new state immediately
      setOptimisticOverrides((prev) => new Map(prev).set(ingredientId, hasIt))

      return { ingredientId, previousValue }
    },
    onError: (err, { hasIt }, context) => {
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
      // The route's `error` is English (HON-914): log it, render catalog copy.
      console.error(
        '[ingredient-availability] toggle failed',
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
      toast.error(hasIt ? t('addFailed') : t('removeFailed'))
    },
    onSettled: (_data, error) => {
      // Only refresh on success
      if (!error) {
        onRefresh()
        // A ran-out staple adds a restock line, so a cached list is stale.
        void queryClient.invalidateQueries({ queryKey: ['shopping-list'] })
      }
    },
  })

  // Derive toggling IDs from pending mutations
  const togglingIngredientIds = new Set<string>()
  if (toggleMutation.isPending && toggleMutation.variables) {
    togglingIngredientIds.add(toggleMutation.variables.ingredientId)
  }

  const handleToggleAvailability = useCallback(
    (ingredientId: string, hasIt: boolean, isStaple = false) => {
      // Prevent double-clicks while already toggling this ingredient
      if (toggleMutation.isPending && toggleMutation.variables?.ingredientId === ingredientId)
        return

      toggleMutation.mutate({ ingredientId, hasIt, isStaple })
    },
    [toggleMutation],
  )

  return { togglingIngredientIds, optimisticOverrides, handleToggleAvailability }
}
