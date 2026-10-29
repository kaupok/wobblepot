'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { track } from '@/lib/analytics'
import { ApiError, apiFetch } from '@/lib/api'
import { MAX_MEAL_COMPONENTS } from '@/lib/meal-planning/components-schema'

/** What `POST .../components/promote` did: a new recipe, or the own recipe updated. */
export interface PromoteResult {
  outcome: 'forked' | 'updated'
  mealId: string
}

/**
 * The refusals the promote route answers with a `code` the household can act
 * on, as keys under `meal-plan.changes.promote.errors`.
 */
export const PROMOTE_ERROR_KEYS = {
  notPlanned: 'notPlanned',
  noChanges: 'noChanges',
  mealNotFound: 'mealNotFound',
  changesMoved: 'changesMoved',
  invalidRecipe: 'invalidRecipe',
  ingredientNotFound: 'ingredientNotFound',
} as const

interface UsePromoteEntryOptions {
  planId: string
  entryId: string
  /**
   * Called once the recipe is saved. The server nulled the entry's cached
   * steps in the same write, so the caller drops the ones on screen.
   */
  onChanged?: () => void
}

/**
 * "Make it my recipe" (HON-1245): keeps a planned entry's ingredient changes
 * as a household recipe. The planner reads its entries from the server
 * render, so a success refreshes the route: the card's My recipe icon and the
 * cleared Changed badge come back from `loadPlanEntries`.
 */
export function usePromoteEntry({ planId, entryId, onChanged }: UsePromoteEntryOptions) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const t = useTranslations('meal-plan.changes.promote')

  const mutation = useMutation({
    mutationFn: (name: string) =>
      apiFetch<PromoteResult>(`/api/meal-plans/${planId}/entries/${entryId}/components/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    onSuccess: (result) => {
      if (result.outcome === 'forked') void track('recipe:created', { source: 'plan_entry' })
      toast.success(t(result.outcome))
      onChanged?.()
      void queryClient.invalidateQueries({ queryKey: ['meals'] })
      void queryClient.invalidateQueries({ queryKey: ['meal', result.mealId] })
      void queryClient.invalidateQueries({ queryKey: ['shopping-list', planId] })
      router.refresh()
    },
    // Never `error.message`: it is the route's English `error` (CLAUDE.md →
    // Localization). The `code` picks the catalog copy.
    onError: (error) => {
      const code = error instanceof ApiError ? error.code : undefined
      const key =
        code && Object.hasOwn(PROMOTE_ERROR_KEYS, code)
          ? PROMOTE_ERROR_KEYS[code as keyof typeof PROMOTE_ERROR_KEYS]
          : 'failed'
      console.error('[promote-entry] request failed', {
        status: error instanceof ApiError ? error.status : undefined,
        code,
      })
      toast.error(t(`errors.${key}`, { max: MAX_MEAL_COMPONENTS }))
    },
  })

  return {
    /** Resolves true once the recipe is saved, false on a refusal (already toasted). */
    promote: (name: string) =>
      mutation.mutateAsync(name).then(
        () => true,
        () => false,
      ),
    isPending: mutation.isPending,
  }
}
