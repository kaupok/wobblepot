'use client'

import { useMutation } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import type { MealType } from '@/generated/prisma/enums'
import { ApiError, apiFetch } from '@/lib/api'
import type { FridgeItemInput } from '@/lib/meal-plans/fridge-items'

import type { EntryRating } from './types'

/**
 * What Undo posts back to the create route after Clear (HON-1123): the entry
 * as the card shows it now. The cached tips are left out; the cook view
 * regenerates them on open.
 */
export interface ClearedMealEntry {
  date: string
  mealType: MealType
  mealId: string
  note: string | null
  noteX: number | null
  noteY: number | null
  servingOverride: number | null
  status: 'planned' | 'skipped'
  rating: EntryRating | null
  pantryDeducted: boolean
}

/**
 * What Undo posts back after a fridge meal is cleared: its items, its note
 * (HON-1277), its status, since Past meals offers Remove on a skipped one
 * (HON-1383), and whether the pantry was charged, so a restored meal is not
 * charged a second time (HON-1444).
 */
export interface ClearedFridgeMeal {
  date: string
  mealType: MealType
  fridgeItems: FridgeItemInput[]
  status: 'planned' | 'skipped'
  note: string | null
  noteX: number | null
  noteY: number | null
  pantryDeducted: boolean
}

export type ClearedEntry = ClearedMealEntry | ClearedFridgeMeal

interface UseClearEntryOptions {
  planId: string
  entryId: string
  /** What the "Cleared" toast names: the meal, or "Fridge meal". */
  name: string
  /**
   * Called once Clear has deleted the entry, before the refresh that unmounts
   * the card, so the page can move focus to the slot that replaces it.
   */
  onCleared?: () => void
}

/**
 * Clear on a planner card, with Undo in the toast, shared by the recipe card
 * and the fridge-meal card. `clear` takes the entry as the card shows it now,
 * which Undo posts back to the create route.
 */
export function useClearEntry({ planId, entryId, name, onCleared }: UseClearEntryOptions) {
  const router = useRouter()
  const tCard = useTranslations('meal-plan.card')

  // Undo posts the cleared entry to the create route. It runs after this card
  // has unmounted, which is why its callbacks live here rather than in
  // `mutate()`'s options: those are skipped once the component unmounts.
  const restoreMutation = useMutation({
    mutationFn: (entry: ClearedEntry) =>
      apiFetch<{ id: string }>(
        `/api/meal-plans/${planId}/entries`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // `restore`: the items are ones the household already had, so the
          // leftover source rule does not judge them again (HON-1396).
          body: JSON.stringify({ ...entry, restore: true }),
        },
        tCard('undoFailed'),
      ),
    onSuccess: () => {
      router.refresh()
    },
    onError: (err) => {
      // The route's `error` is English (HON-914): log it, render catalog copy.
      console.error(
        '[meal-card] restore after clear failed',
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
      // A 409: the slot was filled again meanwhile, by another member or tab.
      // The new entry stays, and the refresh shows it in place of the stale
      // empty slot, which would only answer a second 409.
      if (err instanceof ApiError && err.status === 409) {
        toast.error(tCard('undoSlotFilled'))
        router.refresh()
        return
      }
      toast.error(tCard('undoFailed'))
    },
  })

  // One tap clears, and a toast offers Undo for a few seconds: the menu is a
  // small target on a phone, and Clear sits under Swap (HON-1123).
  const clearMutation = useMutation({
    mutationFn: (_entry: ClearedEntry) =>
      apiFetch<{ success: true }>(`/api/meal-plans/${planId}/entries/${entryId}`, {
        method: 'DELETE',
      }),
    onSuccess: (_data, entry) => {
      onCleared?.()
      router.refresh()
      toast(tCard('cleared', { name }), {
        action: { label: tCard('undo'), onClick: () => restoreMutation.mutate(entry) },
        duration: 6000,
      })
    },
    onError: () => {
      toast.error(tCard('clearFailed'))
    },
  })

  return {
    clear: (entry: ClearedEntry) => clearMutation.mutate(entry),
    isClearing: clearMutation.isPending,
  }
}
