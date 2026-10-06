'use client'

import { useState, useCallback, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ApiError, apiFetch } from '@/lib/api'
import {
  PREPARATION_STEPS_ERROR_KEYS,
  preparationStepsFallbackKey,
  translateErrorCode,
  type PreparationStepsErrorCode,
} from '@/lib/ai/error-codes'
import type { PreparationSteps } from '@/components/meal-plan/types'

interface UseMealStepsOptions {
  planId: string
  entryId: string
  initialSteps?: PreparationSteps | null
}

// Conditions a retry 2s later would only hit again — see `isRetryable`.
const NON_RETRYABLE_CODES: ReadonlySet<string> = new Set([
  'generation_disabled',
  'rate_limited',
  'ai_cap_exceeded',
] satisfies PreparationStepsErrorCode[])

/**
 * Auto-retry once after 2s for retryable server errors.
 *
 * 504 is deliberately excluded: it means the route already spent its full 45s
 * AI budget and gave up, so a retry buys another 45s of spinner — ~92s before
 * the user sees anything — for a request that just demonstrated it does not
 * fit. The other 5xx codes fail fast, so retrying those still costs ~2s
 * (HON-693).
 *
 * The `ai_generation_enabled` kill-switch 503 is excluded too: it will still be
 * off 2s later, and the retry would only spend another rate-limit token.
 *
 * So are the two 429s the household causes itself: its hourly `rate_limited`
 * limit and the monthly `ai_cap_exceeded` cap. Neither clears in 2s, so the
 * retry only delays the message — and on the cap path it spends another hourly
 * token, because the route checks the rate limit before the cap (HON-893).
 * `provider_busy` (Anthropic's own 429) and a codeless 429 still retry: those
 * usually clear in moments.
 */
function isRetryable(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status !== 504 &&
    !NON_RETRYABLE_CODES.has(error.code ?? '') &&
    (error.status >= 500 || error.status === 429)
  )
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
        if (!isRetryable(error)) throw error
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
      // A network failure never reached the route, so it has no code to read.
      if (!(error instanceof ApiError)) {
        setStepsError(t('errors.tipsFailed'))
        return
      }
      // Never `error.message`: `apiFetch` fills it from the route's English
      // `error`, which would render verbatim to an Estonian household. The
      // `code` picks the catalog copy; the prose is a console breadcrumb only
      // (HON-888).
      const body = error.body as { error?: unknown; message?: unknown }
      console.error('[preparation-tips] request failed', {
        status: error.status,
        code: error.code,
        error: body.error,
        message: body.message,
      })
      const key = translateErrorCode(
        error.code,
        PREPARATION_STEPS_ERROR_KEYS,
        preparationStepsFallbackKey(error.status),
      )
      setStepsError(t(`errors.${key}`))
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
