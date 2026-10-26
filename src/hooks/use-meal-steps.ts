'use client'

import { useState, useCallback, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api'
import { isRetryableStepsError, stepsErrorMessage } from './steps-error'
import type { Locale } from '@/lib/i18n/locales'
import type { PreparationSteps } from '@/components/meal-plan/types'

interface UseMealStepsOptions {
  planId: string
  entryId: string
  initialSteps?: PreparationSteps | null
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(id)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
}

export function useMealSteps({ planId, entryId, initialSteps = null }: UseMealStepsOptions) {
  const [steps, setSteps] = useState<PreparationSteps | null>(initialSteps)
  const [stepsError, setStepsError] = useState<string | null>(null)
  const [isStepsExpanded, setIsStepsExpanded] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const t = useTranslations('meal-plan.steps')
  const locale = useLocale() as Locale

  // A mutation, not a query: the POST runs a billed AI generation on demand,
  // and the result lives in local state that callers can reset (`cancelSteps`).
  const { mutateAsync, isPending: isLoadingSteps } = useMutation({
    mutationFn: ({ signal }: AbortController) => {
      const request = () =>
        apiFetch<{ tips: PreparationSteps }>(
          `/api/meal-plans/${planId}/entries/${entryId}/preparation-tips`,
          { method: 'POST', signal },
          t('errors.tipsFailed'),
        )
      return request().catch(async (error: unknown) => {
        if (!isRetryableStepsError(error)) throw error
        await abortableDelay(2000, signal)
        return request()
      })
    },
    // An aborted request — superseded by a newer `fetchSteps`, or dropped by
    // `cancelSteps` — must not write its result or its error into the state.
    onSuccess: (data, controller) => {
      if (controller.signal.aborted) return
      setSteps(data.tips)
    },
    onError: (error, controller) => {
      if (controller.signal.aborted) return
      if (error instanceof DOMException && error.name === 'AbortError') return
      setStepsError(stepsErrorMessage(error, t, locale, '[preparation-tips]'))
    },
  })

  const fetchSteps = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStepsError(null)
    setIsStepsExpanded(true)

    // Failures are handled in `onError`; the rejection only needs swallowing.
    await mutateAsync(controller).catch(() => {})
  }, [mutateAsync])

  const handleHowToPrepare = useCallback(() => {
    if (steps) {
      setIsStepsExpanded((prev) => !prev)
    } else {
      fetchSteps()
    }
  }, [steps, fetchSteps])

  /**
   * Drop the tips and stop any generation still running for them. For callers
   * that have just changed one of the inputs the tips were generated from — the
   * entry's serving count, say — which the server answers by nulling the cached
   * copy (HON-681).
   *
   * Clearing the state alone is not enough: a generation takes up to 45s, and
   * the request in flight would resolve afterwards and `setSteps` the stale
   * object right back — after which `handleHowToPrepare` short-circuits on it
   * and never re-fetches, while the stored row is correctly null. Aborting
   * first makes the mutation's `onSuccess` / `onError` skip it instead.
   */
  const cancelSteps = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setSteps(null)
    setStepsError(null)
    setIsStepsExpanded(false)
  }, [])

  return {
    steps,
    isLoadingSteps,
    stepsError,
    isStepsExpanded,
    fetchSteps,
    handleHowToPrepare,
    cancelSteps,
    setSteps,
    setIsStepsExpanded,
    setStepsError,
  }
}
