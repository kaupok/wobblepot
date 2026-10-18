'use client'

import { useMutation } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ApiError, apiFetch } from '@/lib/api'

/** The body of `POST .../entries/[entryId]/components` (`entryChangeSchema`). */
export interface NewEntryChange {
  originalIngredientId: string | null
  replacementIngredientId: string | null
  quantityPerServing: number | null
}

/**
 * The refusals the change routes answer with a `code` the household can act
 * on, as keys under `meal-plan.changes.errors`. Shared with "Adjust recipe".
 */
export const ENTRY_CHANGE_ERROR_KEYS = {
  notPlanned: 'notPlanned',
  alreadyChanged: 'alreadyChanged',
  alreadyInMeal: 'alreadyInMeal',
  changesMoved: 'changesMoved',
  ingredientNotFound: 'ingredientNotFound',
} as const

interface UseEntryChangesOptions {
  planId: string
  entryId: string
  /**
   * Called after a change or an undo landed. The server nulled the entry's
   * cached steps in the same write, so the caller drops the ones on screen.
   */
  onChanged?: () => void
}

/**
 * Change one planned entry's ingredients, and undo a change (HON-1243). The
 * planner reads its entries from the server render, so a success refreshes
 * the route: the merged ingredients, the nutrition, the conflicts and the
 * Changed badge all come back from `loadPlanEntries`, never patched here.
 */
export function useEntryChanges({ planId, entryId, onChanged }: UseEntryChangesOptions) {
  const router = useRouter()
  const t = useTranslations('meal-plan.changes.errors')
  const base = `/api/meal-plans/${planId}/entries/${entryId}/components`

  // Never `error.message`: it is the route's English `error` (CLAUDE.md →
  // Localization). The `code` picks the catalog copy.
  const toastError = (error: unknown, fallback: 'failed' | 'undoFailed') => {
    const code = error instanceof ApiError ? error.code : undefined
    const key =
      code && Object.hasOwn(ENTRY_CHANGE_ERROR_KEYS, code)
        ? ENTRY_CHANGE_ERROR_KEYS[code as keyof typeof ENTRY_CHANGE_ERROR_KEYS]
        : fallback
    console.error('[entry-changes] request failed', {
      status: error instanceof ApiError ? error.status : undefined,
      code,
    })
    toast.error(t(key))
  }

  const settle = () => {
    onChanged?.()
    router.refresh()
  }

  const add = useMutation({
    mutationFn: (change: NewEntryChange) =>
      apiFetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      }),
    onSuccess: settle,
    onError: (error) => toastError(error, 'failed'),
  })

  const undo = useMutation({
    mutationFn: (changeId: string) =>
      apiFetch(`${base}/${encodeURIComponent(changeId)}`, { method: 'DELETE' }),
    onSuccess: settle,
    onError: (error) => toastError(error, 'undoFailed'),
  })

  return {
    /** Resolves true once the change is stored, false on a refusal (already toasted). */
    addChange: (change: NewEntryChange) =>
      add.mutateAsync(change).then(
        () => true,
        () => false,
      ),
    /** Resolves true once the change is reverted, false on a refusal (already toasted). */
    undoChange: (changeId: string) =>
      undo.mutateAsync(changeId).then(
        () => true,
        () => false,
      ),
    isAdding: add.isPending,
    /** The change an Undo is in flight for, so its row can show it. */
    undoingId: undo.isPending ? undo.variables : undefined,
  }
}
