'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ApiError, apiFetch } from '@/lib/api'
import {
  ADJUST_RECIPE_ERROR_KEYS,
  adjustRecipeFallbackKey,
  rateLimitMessage,
  translateErrorCode,
} from '@/lib/ai/error-codes'
import type { Locale } from '@/lib/i18n/locales'
import type { AdjustProposal } from '@/lib/meal-planning/adjust-proposal'
import { ENTRY_CHANGE_ERROR_KEYS, type NewEntryChange } from './use-entry-changes'

/** The answer of `POST .../entries/[entryId]/adjust`. */
export interface AdjustResponse {
  changes: AdjustProposal[]
  /** The steps should follow the instruction even with no change to apply. */
  followInSteps: boolean
  unmatched: string[]
}

interface UseAdjustRecipeOptions {
  planId: string
  entryId: string
  /** The changes landed, and the server dropped the entry's cached steps. */
  onChanged?: () => void
}

/**
 * "Adjust recipe" (HON-1244): ask for proposals, then apply the ones the
 * household kept as the entry's whole change set. As `useEntryChanges`, a
 * success refreshes the route, so the merged ingredients come back from the
 * server render.
 */
export function useAdjustRecipe({ planId, entryId, onChanged }: UseAdjustRecipeOptions) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const locale = useLocale() as Locale
  const t = useTranslations('meal-plan.adjust.errors')
  const tChange = useTranslations('meal-plan.changes.errors')
  const base = `/api/meal-plans/${planId}/entries/${entryId}`

  const propose = useMutation({
    mutationFn: (instruction: string) =>
      apiFetch<AdjustResponse>(`${base}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction }),
      }),
  })

  const apply = useMutation({
    mutationFn: (body: {
      changes: NewEntryChange[]
      basedOn: string[]
      adjustmentNote: string | null
      noteMode: 'append' | 'replace'
    }) =>
      apiFetch(`${base}/components`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      onChanged?.()
      void queryClient.invalidateQueries({ queryKey: ['shopping-list', planId] })
      router.refresh()
    },
    onError: (error) => {
      // The change routes' refusals share copy with the manual controls.
      const code = error instanceof ApiError ? error.code : undefined
      console.error('[adjust-recipe] apply failed', {
        status: error instanceof ApiError ? error.status : undefined,
        code,
      })
      // Someone else changed the meal: load their change, so Apply builds on it.
      if (code === 'changesMoved') router.refresh()
      toast.error(
        code && Object.hasOwn(ENTRY_CHANGE_ERROR_KEYS, code)
          ? tChange(ENTRY_CHANGE_ERROR_KEYS[code as keyof typeof ENTRY_CHANGE_ERROR_KEYS])
          : t('applyFailed'),
      )
    },
  })

  // Never `error.message`: it is the route's English `error` (CLAUDE.md →
  // Localization). The `code` picks the catalog copy.
  let proposeError: string | null = null
  if (propose.error) {
    const error = propose.error
    const status = error instanceof ApiError ? error.status : 0
    const code = error instanceof ApiError ? error.code : undefined
    const { key, values } = rateLimitMessage(
      translateErrorCode(code, ADJUST_RECIPE_ERROR_KEYS, adjustRecipeFallbackKey(status)),
      'rateLimited',
      error instanceof ApiError ? error.body : undefined,
      locale,
    )
    proposeError = t(key, values)
  }

  return {
    /** Resolves with the proposals, or null on a failure (shown as `proposeError`). */
    propose: (instruction: string) =>
      propose.mutateAsync(instruction).then(
        (response) => response,
        () => null,
      ),
    isProposing: propose.isPending,
    proposeError,
    resetProposal: propose.reset,
    /** Resolves true once the set is stored, false on a refusal (already toasted). */
    apply: (
      changes: NewEntryChange[],
      basedOn: string[],
      adjustmentNote: string | null,
      noteMode: 'append' | 'replace' = 'append',
    ) =>
      apply.mutateAsync({ changes, basedOn, adjustmentNote, noteMode }).then(
        () => true,
        () => false,
      ),
    isApplying: apply.isPending,
  }
}
