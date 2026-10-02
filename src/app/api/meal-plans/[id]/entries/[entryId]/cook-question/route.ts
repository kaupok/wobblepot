import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createAnthropic } from '@ai-sdk/anthropic'
import { streamText, type LanguageModelUsage } from 'ai'
import { isAiBudgetTimeout } from '@/lib/ai/timeout'
import { aiErrorStatusCode } from '@/lib/ai/error-status'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { COOK_QUESTION_MODEL } from '@/lib/ai/models'
import { COOK_QUESTION_AI_BUDGET_MS } from '@/lib/ai/budgets'
import { buildCookQuestionRequest } from '@/lib/ai/cook-question'
import {
  COOK_QUESTION_MAX_LENGTH,
  COOK_QUESTION_PREVIOUS_ANSWER_MAX_LENGTH,
} from '@/lib/ai/cook-question-limits'
import { parseStoredTips } from '@/lib/tips'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'
import { getServerFlag } from '@/lib/feature-flags'
import { logAiSample } from '@/lib/ai/sampling'
import {
  AiCostCapExceededError,
  assertUnderCap,
  recordAiUsage,
  respondCapExceeded,
  toAiUsageStats,
} from '@/lib/ai/usage'
import { withRequestId } from '@/lib/request-id'
import { captureApiError } from '@/lib/errors'
import { getEffectiveServings } from '@/lib/meal-planning/servings'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import type { CookQuestionErrorCode } from '@/lib/ai/error-codes'

/**
 * `code` is what `useCookQuestion` renders from, via `COOK_QUESTION_ERROR_KEYS`;
 * `error` is English and stays in the body for logs only (HON-888).
 */
function errorBody(error: string, code: CookQuestionErrorCode) {
  return { error, code }
}

/**
 * What an `abort` part stands for. The only signal is the budget, so its reason
 * is the `TimeoutError` that `isAiBudgetTimeout` maps to a 504.
 */
function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError')
}

/**
 * The steps come from the client because the entry may hold none: the tips
 * route serves steps uncached when the member count moved, during a locale
 * rollback, or when its guarded write matched nothing (HON-681, HON-683,
 * HON-921). Bounded so a request cannot grow the prompt without limit.
 */
const bodySchema = z
  .object({
    stepIndex: z.number().int().min(0),
    steps: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
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
  })
  .refine((body) => body.stepIndex < body.steps.length)

async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json(errorBody('Unauthorized', 'unauthorized'), { status: 401 })
  }

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json(errorBody('No household found', 'no_household'), { status: 404 })
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(errorBody('Invalid question', 'invalid_question'), { status: 400 })
  }
  const { stepIndex, steps, question, previous } = parsed.data

  const { household } = membership
  const { id: planId, entryId } = await params
  // Resolved, so a locale rolled back out of KNOWN_LOCALES gets English names
  // and an English prompt (HON-921). This route writes nothing, so there is
  // no cache to guard against the stored locale.
  const locale = resolveHouseholdLocale(household)
  const errorContext = {
    route: '/api/meal-plans/[id]/entries/[entryId]/cook-question',
    userId: session.user.id,
    feature: 'cook_question',
  }

  try {
    const entry = await prisma.mealPlanEntry.findFirst({
      where: {
        id: entryId,
        planId: planId,
        plan: {
          householdId: household.id,
        },
      },
      include: {
        meal: {
          include: {
            ...mealTranslationsInclude(locale),
            components: {
              include: {
                ingredient: {
                  select: {
                    name: true,
                    defaultUnit: true,
                    ...ingredientTranslationsInclude(locale),
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!entry) {
      return NextResponse.json(errorBody('Entry not found', 'entry_not_found'), { status: 404 })
    }

    if (!entry.meal) {
      return NextResponse.json(errorBody('No meal assigned to this entry', 'no_meal'), {
        status: 400,
      })
    }

    const rateLimitResult = await checkRateLimit(household.id, 'cook-question')
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          ...errorBody('Rate limit exceeded', 'rate_limited'),
          message: `Maximum ${rateLimitResult.limit} cook questions per hour`,
          resetAt: rateLimitResult.resetAt.toISOString(),
        },
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSeconds(rateLimitResult)) },
        },
      )
    }

    const aiEnabled = await getServerFlag('ai_generation_enabled', session.user.id)
    if (!aiEnabled) {
      return NextResponse.json(
        errorBody('AI generation is temporarily disabled', 'generation_disabled'),
        { status: 503 },
      )
    }

    try {
      await assertUnderCap(household.id)
    } catch (error) {
      if (error instanceof AiCostCapExceededError) {
        return respondCapExceeded(error)
      }
      throw error
    }

    // Names only: the answer may say what the household has, never how much.
    // In stock means a quantity left or none recorded; a 0 means it ran out.
    const pantryItems = await prisma.pantryItem.findMany({
      where: {
        householdId: household.id,
        OR: [{ isStaple: true }, { quantity: null }, { quantity: { gt: 0 } }],
      },
      select: {
        isStaple: true,
        ingredient: { select: { name: true, ...ingredientTranslationsInclude(locale) } },
      },
      orderBy: { ingredient: { name: 'asc' } },
    })

    // The household's names, as the tips prompt reads them (HON-913).
    const shownMeal = translateMeal(entry.meal, locale)
    const mealName = shownMeal.name
    // The cached tips give Watch out and Tip when the entry holds them. The
    // steps never come from here: the request carries the ones on screen.
    const cachedTips = entry.preparationTips ? parseStoredTips(entry.preparationTips) : null
    const preferences = household.preferences

    const aiRequest = buildCookQuestionRequest({
      mealName,
      servings: getEffectiveServings(entry, household._count.members),
      timeMinutes: entry.meal.timeMinutes,
      components: entry.meal.components.map((comp) => ({
        name: translateIngredient(comp.ingredient, locale).name,
        quantityPerServing: comp.quantityPerServing,
        defaultUnit: comp.ingredient.defaultUnit,
      })),
      preparationNotes: shownMeal.preparationNotes ?? null,
      steps,
      stepIndex,
      pitfalls: cachedTips?.pitfalls ?? [],
      tip: cachedTips?.tip ?? null,
      pantry: pantryItems.map((item) => ({
        name: translateIngredient(item.ingredient, locale).name,
        isStaple: item.isStaple,
      })),
      // Passed as restrictions the model must follow, not preferences (HON-896).
      restrictions: {
        allergens: (preferences?.allergensToAvoid ?? []) as string[],
        dietaryType: preferences?.dietaryType ?? null,
        excludedIngredients: preferences?.excludedIngredients ?? [],
        restrictions: preferences?.restrictions ?? [],
      },
      question,
      previous,
      locale,
    })

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

    // Before the first word: an error falls through to the catch below.
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
        householdId: household.id,
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
          // `source` is where Watch out and Tip came from: the entry's cached
          // tips, or none because the steps were served uncached. The
          // chip-or-typed source is the analytics event's, and the route
          // never sees it.
          await logAiSample({
            callSite: 'cook-question',
            locale,
            input: { mealName, stepIndex, source: cachedTips ? 'cached' : 'uncached' },
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
  } catch (error) {
    captureApiError(error, errorContext)

    const statusCode = aiErrorStatusCode(error)

    if (statusCode === 429) {
      return NextResponse.json(
        errorBody('AI service is busy. Please try again in a moment.', 'provider_busy'),
        { status: 429 },
      )
    }

    if (statusCode === 529 || statusCode === 503) {
      return NextResponse.json(
        errorBody('AI service temporarily unavailable. Please try again.', 'provider_unavailable'),
        { status: 502 },
      )
    }

    // A budget that fires during ai@7's retry sleep surfaces as `AbortError`,
    // not `TimeoutError` (HON-694).
    if (isAiBudgetTimeout(error)) {
      return NextResponse.json(
        errorBody('Request timed out. Please try again.', 'question_timeout'),
        { status: 504 },
      )
    }

    return NextResponse.json(
      errorBody("Couldn't answer the question. Try again.", 'question_failed'),
      { status: 500 },
    )
  }
}

/**
 * Platform execution ceiling for this route, in seconds. Stated so the
 * `COOK_QUESTION_AI_BUDGET_MS` budget and its 504 stay reachable (HON-693).
 */
export const maxDuration = 60

export const POST = withRequestId(handlePOST)
