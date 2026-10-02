'use client'

import { useState, useCallback, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ApiError, apiFetch } from '@/lib/api'
import { track } from '@/lib/analytics'
import {
  COOK_QUESTION_ERROR_KEYS,
  cookQuestionFallbackKey,
  translateErrorCode,
  type CookQuestionErrorCode,
} from '@/lib/ai/error-codes'

interface UseCookQuestionOptions {
  planId: string
  entryId: string
  /** For the analytics event only */
  mealId: string
}

export type CookQuestionSource = 'chip' | 'text'

export interface CookQuestionAskInput {
  stepIndex: number
  /** The steps on screen; the route answers about these, not the cached ones */
  steps: string[]
  question: string
  source: CookQuestionSource
}

/** The one question on screen. `answer` is null until it arrives. */
export interface CookQuestionActive {
  stepIndex: number
  question: string
  answer: string | null
}

export interface CookQuestionError {
  message: string
  /** Whether Retry can help. False when it would hit the same wall again. */
  canRetry: boolean
}

type AskRequest = Omit<CookQuestionAskInput, 'source'>

interface QuestionState {
  active: CookQuestionActive | null
  /**
   * The answered question that was on screen when `active` was sent, for the
   * same step. Held only while `active` waits: the new answer or an error
   * takes its place (HON-978).
   */
  previous: CookQuestionActive | null
}

const NO_QUESTION: QuestionState = { active: null, previous: null }

// Conditions a retry 2s later would only hit again — see `isRetryable`.
const NON_RETRYABLE_CODES: ReadonlySet<string> = new Set([
  'generation_disabled',
  'rate_limited',
  'ai_cap_exceeded',
] satisfies CookQuestionErrorCode[])

// Codes where a Retry button cannot help: the same request gets the same
// answer until the household, the plan or the hour changes.
const NO_RETRY_BUTTON_CODES: ReadonlySet<string> = new Set([
  'generation_disabled',
  'rate_limited',
  'ai_cap_exceeded',
  'invalid_question',
  'unauthorized',
  'no_household',
  'entry_not_found',
  'no_meal',
] satisfies CookQuestionErrorCode[])

/**
 * Auto-retry once after 2s, by the rules `useMealTips` documents: not a 504
 * (the route already spent its whole budget), not the kill switch, and not the
 * household's own hourly limit or monthly cap (HON-693, HON-893).
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

/**
 * One question about one step of the cook view, and its answer (HON-969).
 * Holds a single question, not one per step: one panel is open at a time, and
 * closing it discards the answer. Nothing is persisted.
 */
export function useCookQuestion({ planId, entryId, mealId }: UseCookQuestionOptions) {
  const [{ active, previous }, setQuestion] = useState<QuestionState>(NO_QUESTION)
  const [error, setError] = useState<CookQuestionError | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const lastRequestRef = useRef<AskRequest | null>(null)
  const t = useTranslations('meal-plan.cookQuestion')

  // A mutation, not a query: each POST runs a billed AI call on demand, and
  // the answer lives in local state the caller resets.
  const { mutateAsync, isPending } = useMutation({
    mutationFn: ({
      controller: { signal },
      request,
    }: {
      controller: AbortController
      request: AskRequest
    }) => {
      const send = () =>
        apiFetch<{ answer: string }>(
          `/api/meal-plans/${planId}/entries/${entryId}/cook-question`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            signal,
          },
          t('errors.questionFailed'),
        )
      return send().catch(async (err: unknown) => {
        if (!isRetryable(err)) throw err
        await abortableDelay(2000, signal)
        return send()
      })
    },
    // A superseded or reset request must not write its result or its error.
    onSuccess: (data, { controller, request }) => {
      if (controller.signal.aborted) return
      setQuestion({
        active: { stepIndex: request.stepIndex, question: request.question, answer: data.answer },
        previous: null,
      })
    },
    onError: (err, { controller }) => {
      if (controller.signal.aborted) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      // The error takes the old answer's place, as an answer would.
      setQuestion((current) => ({ ...current, previous: null }))
      // A network failure never reached the route, so it has no code to read.
      if (!(err instanceof ApiError)) {
        setError({ message: t('errors.questionFailed'), canRetry: true })
        return
      }
      // Never `err.message`: it carries the route's English `error` (HON-888).
      const body = err.body as { error?: unknown }
      console.error('[cook-question] request failed', {
        status: err.status,
        code: err.code,
        error: body.error,
      })
      const key = translateErrorCode(
        err.code,
        COOK_QUESTION_ERROR_KEYS,
        cookQuestionFallbackKey(err.status),
      )
      setError({
        message: t(`errors.${key}`),
        canRetry: !NO_RETRY_BUTTON_CODES.has(err.code ?? ''),
      })
    },
  })

  const send = useCallback(
    async (request: AskRequest) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      lastRequestRef.current = request

      setError(null)
      setQuestion((current) => {
        // The answer on screen stays until the new one replaces it, so the
        // panel keeps its height and the steps below do not jump (HON-978).
        // An answer still waiting keeps the one it is already showing.
        const onScreen = current.active?.answer != null ? current.active : current.previous
        return {
          active: { stepIndex: request.stepIndex, question: request.question, answer: null },
          previous: onScreen?.stepIndex === request.stepIndex ? onScreen : null,
        }
      })

      // Failures are handled in `onError`; the rejection only needs swallowing.
      await mutateAsync({ controller, request }).catch(() => {})
    },
    [mutateAsync],
  )

  /**
   * Send a question and abort one in flight. The answer on screen stays, as
   * `previous`, until the new answer or an error replaces it.
   */
  const ask = useCallback(
    ({ source, ...request }: CookQuestionAskInput) => {
      void track('cook_view:question_asked', {
        plan_id: planId,
        meal_id: mealId,
        step_index: request.stepIndex,
        source,
      })
      return send(request)
    },
    [send, planId, mealId],
  )

  /** Send the last question again, after an error. Not a new ask for analytics. */
  const retry = useCallback(() => {
    if (lastRequestRef.current) return send(lastRequestRef.current)
    return Promise.resolve()
  }, [send])

  /** Drop the question and its answer, and stop a request in flight. */
  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    lastRequestRef.current = null
    setQuestion(NO_QUESTION)
    setError(null)
  }, [])

  return {
    ask,
    active,
    // Only while a question is on screen: a reset request may take a moment
    // to settle its abort.
    isPending: isPending && active !== null && active.answer === null && error === null,
    /** The answered question still on screen while `active` waits; null otherwise. */
    previous,
    error,
    retry,
    reset,
  }
}
