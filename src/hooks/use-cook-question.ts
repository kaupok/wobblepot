'use client'

import { useState, useCallback, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ApiError, toApiError } from '@/lib/api'
import { track } from '@/lib/analytics'
import {
  COOK_QUESTION_ERROR_KEYS,
  cookQuestionFallbackKey,
  translateErrorCode,
  type CookQuestionErrorCode,
} from '@/lib/ai/error-codes'
import type { CookQuestionPrevious } from '@/lib/ai/cook-question'

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

/**
 * The one question on screen. `answer` is null until the first words arrive,
 * then grows as the answer streams in (HON-979).
 */
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

/**
 * The POST body. `previous` is the last question answered in full on the same
 * step, so a follow-up has something to refer to (HON-980).
 */
type AskRequest = Omit<CookQuestionAskInput, 'source'> & { previous?: CookQuestionPrevious }

/** A question whose answer streamed to its end, for the step it was about. */
type AnsweredQuestion = CookQuestionPrevious & { stepIndex: number }

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

/**
 * The stream broke after the first words arrived. Not retried on its own: the
 * words on screen stay, with the generic error and Retry under them (HON-979).
 */
class PartialAnswerError extends Error {
  constructor(cause: unknown) {
    super('The answer stream ended early', { cause })
    this.name = 'PartialAnswerError'
  }
}

/**
 * Read the streamed answer, handing each piece of text to `onText` as it
 * arrives. Aborting `signal` cancels the read, so `reset` stops it.
 */
async function readAnswer(
  response: Response,
  signal: AbortSignal,
  onText: (text: string) => void,
): Promise<void> {
  if (!response.body) throw new Error('The answer has no body')
  const reader = response.body.getReader()
  signal.addEventListener('abort', () => void reader.cancel().catch(() => {}), { once: true })
  const decoder = new TextDecoder()
  let received = false
  const take = (text: string) => {
    if (!text) return
    received = true
    onText(text)
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      take(decoder.decode(value, { stream: true }))
    }
    take(decoder.decode())
  } catch (err) {
    if (received && !(err instanceof DOMException && err.name === 'AbortError')) {
      throw new PartialAnswerError(err)
    }
    throw err
  }
  if (!received) throw new Error('The answer was empty')
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
  const lastAnsweredRef = useRef<AnsweredQuestion | null>(null)
  const t = useTranslations('meal-plan.cookQuestion')

  // A mutation, not a query: each POST runs a billed AI call on demand, and
  // the answer lives in local state the caller resets.
  const { mutateAsync, isPending } = useMutation({
    mutationFn: async ({
      controller: { signal },
      request,
    }: {
      controller: AbortController
      request: AskRequest
    }) => {
      // Not `apiFetch`: the answer is a text stream, not JSON. A failure is
      // still JSON with a `code`, read into the same `ApiError`.
      const post = async () => {
        const response = await fetch(`/api/meal-plans/${planId}/entries/${entryId}/cook-question`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal,
        })
        if (!response.ok) throw await toApiError(response, t('errors.questionFailed'))
        return response
      }
      // The retry rules apply before the first byte only: after it, the
      // words on screen would be billed and written a second time.
      const response = await post().catch(async (err: unknown) => {
        if (!isRetryable(err)) throw err
        await abortableDelay(2000, signal)
        return post()
      })
      let answer = ''
      await readAnswer(response, signal, (text) => {
        // A superseded or reset request must not write its words.
        if (signal.aborted) return
        answer += text
        // The first words take the old answer's place (HON-978).
        setQuestion(({ active }) => ({
          active: {
            stepIndex: request.stepIndex,
            question: request.question,
            answer: (active?.answer ?? '') + text,
          },
          previous: null,
        }))
      })
      // Only once the stream has closed, and not after an abort: cancelling
      // the read ends it like a close would, with half an answer.
      if (!signal.aborted) {
        lastAnsweredRef.current = {
          stepIndex: request.stepIndex,
          question: request.question,
          answer,
        }
      }
    },
    onError: (err, { controller }) => {
      if (controller.signal.aborted) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      // The error takes the old answer's place, as an answer would. Words
      // that already arrived stay, with the error under them.
      setQuestion((current) => ({ ...current, previous: null }))
      if (err instanceof PartialAnswerError) {
        console.error('[cook-question] answer stream ended early', err.cause)
        setError({ message: t('errors.questionFailed'), canRetry: true })
        return
      }
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
      const last = lastAnsweredRef.current
      const previous =
        last?.stepIndex === request.stepIndex
          ? { question: last.question, answer: last.answer }
          : undefined
      void track('cook_view:question_asked', {
        plan_id: planId,
        meal_id: mealId,
        step_index: request.stepIndex,
        source,
        has_previous: previous !== undefined,
      })
      return send({ ...request, previous })
    },
    [send, planId, mealId],
  )

  /**
   * Send the last question again, after an error, with the same `previous`.
   * Not a new ask for analytics.
   */
  const retry = useCallback(() => {
    if (lastRequestRef.current) return send(lastRequestRef.current)
    return Promise.resolve()
  }, [send])

  /** Drop the question and its answer, and stop a request in flight. */
  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    lastRequestRef.current = null
    lastAnsweredRef.current = null
    setQuestion(NO_QUESTION)
    setError(null)
  }, [])

  // Only while a question is on screen: a reset request may take a moment
  // to settle its abort.
  const inFlight = isPending && active !== null && error === null

  return {
    ask,
    active,
    /** Waiting for the first words; "Thinking…" shows. */
    isPending: inFlight && active.answer === null,
    /**
     * The words are arriving. Send and the chips stay disabled until the
     * stream closes, so a second tap cannot bill a second call (HON-969).
     */
    isStreaming: inFlight && active.answer !== null,
    /** The answered question still on screen while `active` waits; null otherwise. */
    previous,
    error,
    retry,
    reset,
  }
}
