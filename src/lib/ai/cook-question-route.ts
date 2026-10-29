import 'server-only'

import { createAnthropic } from '@ai-sdk/anthropic'
import { type LanguageModelUsage, streamText } from 'ai'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { COOK_QUESTION_AI_BUDGET_MS } from '@/lib/ai/budgets'
import type { buildCookQuestionRequest } from '@/lib/ai/cook-question'
import {
  clipText,
  COOK_QUESTION_EQUIPMENT_ITEM_MAX_LENGTH,
  COOK_QUESTION_EQUIPMENT_MAX_ITEMS,
  COOK_QUESTION_MAX_LENGTH,
  COOK_QUESTION_PREVIOUS_ANSWER_MAX_LENGTH,
} from '@/lib/ai/cook-question-limits'
import type { CookQuestionSubject } from '@/lib/ai/cook-question-subject'
import type { CookQuestionErrorCode } from '@/lib/ai/error-codes'
import { aiErrorStatusCode } from '@/lib/ai/error-status'
import { COOK_QUESTION_MODEL } from '@/lib/ai/models'
import { logAiSample } from '@/lib/ai/sampling'
import { isAiBudgetTimeout } from '@/lib/ai/timeout'
import {
  AiCostCapExceededError,
  assertUnderCap,
  recordAiUsage,
  respondCapExceeded,
  toAiUsageStats,
} from '@/lib/ai/usage'
import { serverEnv } from '@/lib/env'
import { captureApiError } from '@/lib/errors'
import { getServerFlag } from '@/lib/feature-flags'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'

/**
 * What the two cook-question routes share: a planned entry's
 * (`/api/meal-plans/[id]/entries/[entryId]/cook-question`) and a household
 * recipe's (`/api/meals/[id]/cook-question`, HON-1339). Each route loads its
 * own meal; the body, the guards, the streamed answer and the error statuses
 * are one contract, so the two cannot drift apart.
 */

/**
 * `code` is what `useCookQuestion` renders from, via `COOK_QUESTION_ERROR_KEYS`;
 * `error` is English and stays in the body for logs only (HON-888).
 */
export function cookQuestionErrorBody(error: string, code: CookQuestionErrorCode) {
  return { error, code }
}

/**
 * The steps and the equipment come from the client because the entry may hold
 * none: the tips route serves them uncached when the household's servings moved,
 * during a locale rollback, or when its guarded write matched nothing
 * (HON-681, HON-683, HON-921). Bounded so a request cannot grow the prompt
 * without limit.
 */
export const cookQuestionFields = {
  // A step, or an item in "You'll need" (HON-983).
  subject: z.object({
    kind: z.enum(['step', 'equipment']),
    index: z.number().int().min(0),
  }),
  steps: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
  // Clipped, not rejected: the tips schema bounds neither the count nor an
  // item's length, and a step question carries the list as context only, so
  // one long item must not fail every question on the meal. Positions are
  // kept, so an equipment index still names the item on screen.
  equipment: z
    .array(z.string())
    .transform((items) =>
      items
        .slice(0, COOK_QUESTION_EQUIPMENT_MAX_ITEMS)
        .map((item) => clipText(item.trim(), COOK_QUESTION_EQUIPMENT_ITEM_MAX_LENGTH)),
    ),
  question: z.string().trim().min(1).max(COOK_QUESTION_MAX_LENGTH),
  // The last answered question on this step (HON-980). Context only, so a
  // bad one is dropped rather than failing the question it came with.
  previous: z
    .object({
      question: z.string().trim().min(1).max(COOK_QUESTION_MAX_LENGTH),
      answer: z.string().trim().min(1).max(COOK_QUESTION_PREVIOUS_ANSWER_MAX_LENGTH),
    })
    .optional()
    .catch(undefined),
}

/**
 * The index names an entry of the list its kind names: a step, or a
 * non-empty item. For the body's `.refine`.
 */
export function subjectInRange({
  subject,
  steps,
  equipment,
}: {
  subject: CookQuestionSubject
  steps: string[]
  equipment: string[]
}): boolean {
  return subject.kind === 'step' ? subject.index < steps.length : !!equipment[subject.index]
}

/**
 * The rate limit, the AI kill-switch and the monthly cost cap, in that order.
 * The response to send when one refuses, else null.
 */
export async function guardCookQuestion(
  householdId: string,
  userId: string,
): Promise<Response | null> {
  const rateLimitResult = await checkRateLimit(householdId, 'cook-question')
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        ...cookQuestionErrorBody('Rate limit exceeded', 'rate_limited'),
        message: `Maximum ${rateLimitResult.limit} cook questions per hour`,
        resetAt: rateLimitResult.resetAt.toISOString(),
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds(rateLimitResult)) },
      },
    )
  }

  const aiEnabled = await getServerFlag('ai_generation_enabled', userId)
  if (!aiEnabled) {
    return NextResponse.json(
      cookQuestionErrorBody('AI generation is temporarily disabled', 'generation_disabled'),
      { status: 503 },
    )
  }

  try {
    await assertUnderCap(householdId)
  } catch (error) {
    if (error instanceof AiCostCapExceededError) {
      return respondCapExceeded(error)
    }
    throw error
  }
  return null
}

export type CookQuestionErrorContext = { route: string; userId: string; feature: string }

/**
 * What an `abort` part stands for. The only signal is the budget, so its reason
 * is the `TimeoutError` that `isAiBudgetTimeout` maps to a 504.
 */
function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError')
}

/**
 * Streams the answer as plain text. Throws before the first word, so the
 * caller's catch sends `cookQuestionErrorResponse`; after it, an error ends
 * the stream.
 */
export async function streamCookAnswer({
  aiRequest,
  householdId,
  locale,
  sampleInput,
  errorContext,
}: {
  aiRequest: ReturnType<typeof buildCookQuestionRequest>
  householdId: string
  locale: string
  /** What `logAiSample` records as the input, beside the answer. */
  sampleInput: Record<string, unknown>
  errorContext: CookQuestionErrorContext
}): Promise<Response> {
  const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })
  // One wall-clock budget for all AI time in this request, shared by the
  // initial attempt and every retry, and by the streaming that follows.
  // Sized against `maxDuration` in `@/lib/ai/budgets`.
  const timeout = AbortSignal.timeout(COOK_QUESTION_AI_BUDGET_MS)

  // Plain text, streamed: the cook reads the first sentence while the rest
  // is written (HON-979). `streamText` never throws; its errors arrive as
  // parts of the full stream, read here so an error before the first word
  // still gets the JSON status the hook translates.
  const startedAt = Date.now()
  const result = streamText({
    ...aiRequest,
    model: anthropic(COOK_QUESTION_MODEL),
    abortSignal: timeout,
  })
  const parts = result.stream[Symbol.asyncIterator]()
  let usage: LanguageModelUsage | undefined

  // Before the first word: an error falls through to the caller's catch.
  let first: string | null = null
  while (first === null) {
    const next = await parts.next()
    if (next.done) break
    const part = next.value
    if (part.type === 'text-delta' && part.text) first = part.text
    else if (part.type === 'finish') usage = part.totalUsage
    else if (part.type === 'error') throw part.error
    else if (part.type === 'abort') throw abortReason(timeout)
  }

  const recordUsage = (success: boolean) =>
    recordAiUsage({
      householdId,
      feature: 'cook_question',
      // Start of the call to its last part: the whole answer, not the first word.
      ...toAiUsageStats(COOK_QUESTION_MODEL, usage, Date.now() - startedAt),
      ...(!success && { success: false }),
    })

  if (first === null) {
    // Billed, but no answer to show.
    await recordUsage(false)
    throw new Error('Cook question returned no text')
  }

  const firstText = first
  const encoder = new TextEncoder()
  let cancelled = false

  const body = new ReadableStream<Uint8Array>({
    // Pushed, not pulled: the answer is a few sentences, and the model call
    // runs to its end even when the cook closes the panel, so its usage is
    // still recorded.
    start(controller) {
      const send = (text: string) => {
        if (!cancelled) controller.enqueue(encoder.encode(text))
      }
      void (async () => {
        let text = firstText
        send(firstText)
        try {
          for (;;) {
            const next = await parts.next()
            if (next.done) break
            const part = next.value
            if (part.type === 'text-delta') {
              text += part.text
              send(part.text)
            } else if (part.type === 'finish') {
              usage = part.totalUsage
              // Cut off at `maxOutputTokens`, which thinking shares: half an
              // instruction must not read as the whole answer. The words
              // stay, with the error and Retry under them.
              if (part.finishReason === 'length') {
                throw new Error('Cook question answer was cut off at maxOutputTokens')
              }
            } else if (part.type === 'error') throw part.error
            else if (part.type === 'abort') throw abortReason(timeout)
          }
        } catch (error) {
          // Mid-answer: the status is already 200, so the stream ends in an
          // error and the hook shows what arrived with the generic error.
          captureApiError(error, errorContext)
          await recordUsage(false)
          if (!cancelled) controller.error(error)
          return
        }
        // Before the stream closes, so Send stays disabled until the
        // monthly cap has seen this call.
        await recordUsage(true)
        await logAiSample({
          callSite: 'cook-question',
          locale,
          input: sampleInput,
          output: { answer: text },
        })
        if (!cancelled) controller.close()
      })()
    },
    cancel() {
      cancelled = true
    },
  })

  // Nothing is written: the answer lives on the cook's screen only.
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/** The status for an error before the first word, logged first. */
export function cookQuestionErrorResponse(
  error: unknown,
  errorContext: CookQuestionErrorContext,
): Response {
  captureApiError(error, errorContext)

  const statusCode = aiErrorStatusCode(error)

  if (statusCode === 429) {
    return NextResponse.json(
      cookQuestionErrorBody('AI service is busy. Please try again in a moment.', 'provider_busy'),
      { status: 429 },
    )
  }

  if (statusCode === 529 || statusCode === 503) {
    return NextResponse.json(
      cookQuestionErrorBody(
        'AI service temporarily unavailable. Please try again.',
        'provider_unavailable',
      ),
      { status: 502 },
    )
  }

  // A budget that fires during ai@7's retry sleep surfaces as `AbortError`,
  // not `TimeoutError` (HON-694).
  if (isAiBudgetTimeout(error)) {
    return NextResponse.json(
      cookQuestionErrorBody('Request timed out. Please try again.', 'question_timeout'),
      { status: 504 },
    )
  }

  return NextResponse.json(
    cookQuestionErrorBody("Couldn't answer the question. Try again.", 'question_failed'),
    { status: 500 },
  )
}
