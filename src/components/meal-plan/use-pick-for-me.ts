'use client'

import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { useDropPlanSuggestions } from '@/hooks/use-drop-plan-suggestions'
import { ApiError, apiFetch } from '@/lib/api'
import { track } from '@/lib/analytics'
import { rateLimitResetAt } from '@/lib/ai/error-codes'
import { formatTimeOfDay } from '@/lib/i18n/format-dates'
import type { Locale } from '@/lib/i18n/locales'
import type { MealType } from '@/generated/prisma/enums'
import type { AlternativeMeal } from './types'

/**
 * The cleared card's entry: it exists, so the pick fills it, and Undo puts it
 * back with its note where it lay.
 */
export interface ClearedSlot {
  entryId: string
  note: string | null
  noteX: number | null
  noteY: number | null
}

/**
 * A planned card's entry: the pick swaps its meal, and Undo puts the previous
 * meal back. A PATCH, so the note stays (HON-1249).
 */
export interface PlannedSlot {
  entryId: string
  mealId: string
}

interface Swapped {
  entryId: string
  fromMealId: string
  toMealId: string
  mealName: string
}

interface Picked {
  entryId: string
  mealId: string
  mealName: string
  cleared: ClearedSlot | null
}

interface UsePickForMeOptions {
  planId: string
  date: string
  mealType: MealType
  /** Called once the meal is placed, before the refresh that shows it. */
  onPicked?: () => void
  /** Called with the entry's new meal after a swap, and with the previous one after its Undo. */
  onSwapped?: (mealId: string) => void
}

/**
 * "Pick for me": places the slot's top suggestion with no dialog, and a toast
 * offers Undo, as Clear does (HON-1248). An empty slot takes one request, so
 * no placeholder exists if it fails. The cleared card's entry exists, so it
 * asks the suggestions route and assigns the first. A planned card swaps:
 * it asks the regenerate route, which ranks by closeness to the current meal
 * and leaves that meal out (HON-1249).
 *
 * Every callback lives in the `useMutation` options, not `mutate()`'s: the
 * caller unmounts when the refresh lands, and Undo runs after that.
 */
export function usePickForMe({ planId, date, mealType, onPicked, onSwapped }: UsePickForMeOptions) {
  const router = useRouter()
  const dropSuggestionCache = useDropPlanSuggestions(planId)
  const tCard = useTranslations('meal-plan.card')
  const tSelector = useTranslations('meal-plan.selector')
  const tErrors = useTranslations('meal-plan.errors')
  const locale = useLocale() as Locale
  const entriesUrl = `/api/meal-plans/${planId}/entries`

  const undoMutation = useMutation({
    mutationFn: async ({ entryId, cleared }: Picked) => {
      await apiFetch(`${entriesUrl}/${entryId}`, { method: 'DELETE' })
      if (!cleared) return
      // The PATCH route cannot take the meal off an entry, so the cleared
      // card's entry is posted back as it was: the note, at its place.
      await apiFetch(entriesUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          mealType,
          note: cleared.note,
          noteX: cleared.note ? cleared.noteX : null,
          noteY: cleared.note ? cleared.noteY : null,
        }),
      })
    },
    onSuccess: () => {
      dropSuggestionCache()
      router.refresh()
    },
    onError: (err) => {
      // The route's `error` is English (HON-914): log it, render catalog copy.
      console.error(
        '[pick-for-me] undo failed',
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
      toast.error(tCard('undoFailed'))
      // The cleared card's Undo can fail between its two requests, so the
      // page reloads what is there.
      router.refresh()
    },
  })

  const pickMutation = useMutation({
    mutationFn: async (cleared: ClearedSlot | null): Promise<Picked> => {
      if (!cleared) {
        const entry = await apiFetch<{ id: string; mealId: string; mealName: string }>(entriesUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, mealType, pick: 'suggested' }),
        })
        return { entryId: entry.id, mealId: entry.mealId, mealName: entry.mealName, cleared }
      }
      const { alternatives } = await apiFetch<{ alternatives: AlternativeMeal[] }>(
        `${entriesUrl}/${cleared.entryId}/suggestions`,
        { method: 'POST' },
      )
      // The route answers an empty list with a 404 `no_suggestions`; this
      // reads a bare `[]` the same way.
      const [top] = alternatives
      if (!top) throw new ApiError('No suggestions', 404, { body: { code: 'no_suggestions' } })
      await apiFetch(`${entriesUrl}/${cleared.entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mealId: top.id }),
      })
      return { entryId: cleared.entryId, mealId: top.id, mealName: top.name, cleared }
    },
    onSuccess: (picked) => {
      // The placed meal joins the plan's `recentMealIds`, so every other
      // card's cached suggestions may now offer it twice (HON-682).
      dropSuggestionCache()
      onPicked?.()
      router.refresh()
      void track('meal_plan:slot_filled', {
        plan_id: planId,
        meal_id: picked.mealId,
        via: 'pick_for_me',
      })
      toast(tCard('pickedForYou', { name: picked.mealName }), {
        action: { label: tCard('undo'), onClick: () => undoMutation.mutate(picked) },
        duration: 6000,
      })
    },
    onError: (err) => {
      console.error(
        '[pick-for-me] pick failed',
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
      toast.error(pickErrorMessage(err))
    },
  })

  function patchMeal(entryId: string, mealId: string) {
    return apiFetch(`${entriesUrl}/${entryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mealId }),
    })
  }

  const swapUndoMutation = useMutation({
    mutationFn: ({ entryId, fromMealId }: Swapped) => patchMeal(entryId, fromMealId),
    onSuccess: (_data, { fromMealId }) => {
      onSwapped?.(fromMealId)
      dropSuggestionCache()
      router.refresh()
    },
    onError: (err) => {
      console.error(
        '[pick-for-me] swap undo failed',
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
      toast.error(tCard('swapUndoFailed'))
      router.refresh()
    },
  })

  const swapMutation = useMutation({
    mutationFn: async ({ entryId, mealId }: PlannedSlot): Promise<Swapped> => {
      const { alternatives } = await apiFetch<{ alternatives: AlternativeMeal[] }>(
        `${entriesUrl}/${entryId}/regenerate`,
        { method: 'POST' },
      )
      const [top] = alternatives
      if (!top) throw new ApiError('No suggestions', 404, { body: { code: 'no_suggestions' } })
      await patchMeal(entryId, top.id)
      return { entryId, fromMealId: mealId, toMealId: top.id, mealName: top.name }
    },
    onSuccess: (swapped) => {
      onSwapped?.(swapped.toMealId)
      // The meal that left may now be suggested elsewhere, and the one that
      // came may not (HON-682).
      dropSuggestionCache()
      router.refresh()
      void track('meal_plan:meal_swapped', {
        plan_id: planId,
        from_meal_id: swapped.fromMealId,
        to_meal_id: swapped.toMealId,
        source: 'meal_card',
        is_reselect: false,
        via: 'pick_for_me',
      })
      toast(tCard('pickedForYou', { name: swapped.mealName }), {
        action: { label: tCard('undo'), onClick: () => swapUndoMutation.mutate(swapped) },
        duration: 6000,
      })
    },
    onError: (err) => {
      console.error(
        '[pick-for-me] swap failed',
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
      toast.error(pickErrorMessage(err, tSelector('updateMealFailed')))
    },
  })

  function pickErrorMessage(err: unknown, fallback = tCard('createEntryFailed')) {
    if (!(err instanceof ApiError)) return fallback
    const code = (err.body as { code?: unknown } | null)?.code
    if (err.status === 404 && code === 'no_suggestions') return tCard('pickForMeNoMatch')
    // The cap is a 429 too, but it lifts next month, not after a time today.
    if (code === 'ai_cap_exceeded') return tErrors('aiCapExceeded')
    if (err.status === 429) {
      const resetAt = rateLimitResetAt(err.body)
      return resetAt
        ? tSelector('rateLimitedUntil', { time: formatTimeOfDay(resetAt, locale) })
        : tSelector('rateLimited')
    }
    return fallback
  }

  return {
    /** Fills the slot; pass the cleared card's entry when there is one. */
    pick: (cleared: ClearedSlot | null = null) => pickMutation.mutate(cleared),
    /** Swaps a planned card's meal for its top alternative. */
    swap: (planned: PlannedSlot) => swapMutation.mutate(planned),
    isPicking: pickMutation.isPending || swapMutation.isPending,
  }
}
