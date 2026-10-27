import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { isAiBudgetTimeout } from '@/lib/ai/timeout'
import { aiErrorStatusCode } from '@/lib/ai/error-status'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { serverEnv } from '@/lib/env'
import { STEPS_MODEL } from '@/lib/ai/models'
import { STEPS_AI_BUDGET_MS } from '@/lib/ai/budgets'
import { buildFullStepsRequest, buildStepsFromNotesRequest } from '@/lib/ai/preparation-steps'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'
import { getServerFlag } from '@/lib/feature-flags'
import { logAiSample } from '@/lib/ai/sampling'
import {
  AiCostCapExceededError,
  assertUnderCap,
  recordAiUsage,
  respondCapExceeded,
  toAiUsageStats,
  withUsageOnFailure,
} from '@/lib/ai/usage'
import { withRequestId } from '@/lib/request-id'
import { captureApiError } from '@/lib/errors'
import { MAX_SERVINGS, MIN_SERVINGS, sumPortions } from '@/lib/meal-planning/servings'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import {
  freshRecipeSteps,
  loadRecipeForSteps,
  RecipeStepsError,
  recipeStepsRequest,
  saveRecipeSteps,
} from '@/lib/meals/recipe-steps'
import type { PreparationSteps } from '@/components/meal-plan/types'
import type { RecipeStepsErrorCode } from '@/lib/ai/error-codes'

/**
 * `code` is what `useRecipeSteps` renders from; `error` is English and stays
 * in the body for logs only (HON-888).
 */
function errorBody(error: string, code: RecipeStepsErrorCode) {
  return { error, code }
}

/**
 * The servings the view shows, in halves: the household's own portions can be
 * 2.5 (HON-1040). Absent reads as the household's. The range is checked
 * once the household is known, below.
 */
const bodySchema = z.object({
  servings: z.number().positive().multipleOf(0.5).optional(),
})

/**
 * The steps for the recipe cook view (HON-1338), at the servings the view
 * shows: for one of the household's own recipes, or a library meal the meal
 * picker shows (HON-1351). Stored per meal and locale in
 * `MealPreparationSteps`, so a second open at the same servings makes no AI
 * call; a library meal's row is shared by every household. The same prompts
 * as a planned entry's, without what only an entry has: its ingredient
 * changes, its "Adjust recipe" note, its serving override.
 */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(errorBody('Invalid servings', 'invalid_servings'), { status: 400 })
  }

  const { household } = membership
  const { id: mealId } = await params
  // The serving control's range, or the household's own count, which a large
  // household can take past it: the control accepts that count too.
  const householdServings = sumPortions(household.members)
  const servings = parsed.data.servings ?? householdServings
  if (servings !== householdServings && (servings < MIN_SERVINGS || servings > MAX_SERVINGS)) {
    return NextResponse.json(errorBody('Invalid servings', 'invalid_servings'), { status: 400 })
  }
  // Resolved, so a locale rolled back out of KNOWN_LOCALES gets English names
  // and an English prompt (HON-921). The cache write below compares the
  // stored `household.locale`.
  const locale = resolveHouseholdLocale(household)

  try {
    const meal = await loadRecipeForSteps(household.id, mealId, locale)
    const { input, notes, inputHash } = recipeStepsRequest(meal, locale, servings)

    // Before the rate limit: a reopen at the same servings is free.
    const cached = freshRecipeSteps(meal, inputHash)
    if (cached) {
      return NextResponse.json({ tips: cached }, { status: 200 })
    }

    // The household's one steps budget, shared with the planned entries.
    const rateLimitResult = await checkRateLimit(household.id, 'meal-prep-tips')
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          ...errorBody('Rate limit exceeded', 'rate_limited'),
          message: `Maximum ${rateLimitResult.limit} preparation tip requests per hour`,
          resetAt: rateLimitResult.resetAt.toISOString(),
        },
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSeconds(rateLimitResult)) },
        },
      )
    }

    // Kill-switch, after the cache hit so stored steps are still served.
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

    const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })
    // One wall-clock budget for all AI time in this request, shared by the
    // initial attempt and every retry. Sized against `maxDuration` in `@/lib/ai/budgets`.
    const timeout = AbortSignal.timeout(STEPS_AI_BUDGET_MS)

    // A household's own recipe lists what the household wrote, so its list is
    // always the whole meal (HON-1245). A library meal is the library's
    // recipe, unchanged, with no notes. With notes, the steps follow the
    // method in them, and the ingredient list wins where the two differ
    // (HON-1259).
    const base = { ...input, hasChanges: !!meal.householdId }
    const stepsRequest = notes
      ? buildStepsFromNotesRequest({ ...base, preparationNotes: notes })
      : buildFullStepsRequest(base)

    const startedAt = Date.now()
    const result = await withUsageOnFailure(
      STEPS_MODEL,
      (stats) =>
        recordAiUsage({
          householdId: household.id,
          feature: 'entry_preparation_tips',
          ...stats,
        }),
      () =>
        generateObject({
          ...stepsRequest,
          model: anthropic(STEPS_MODEL),
          abortSignal: timeout,
        }),
    )

    await recordAiUsage({
      householdId: household.id,
      feature: 'entry_preparation_tips',
      ...toAiUsageStats(STEPS_MODEL, result.usage, Date.now() - startedAt),
    })

    await logAiSample({
      callSite: notes ? 'preparation-tips-from-notes' : 'preparation-tips-full',
      locale,
      input: {
        mealName: input.mealName,
        householdSize: servings,
        timeMinutes: input.timeMinutes,
        ingredientsCount: input.components.length,
        hasUserNotes: notes !== null,
      },
      output: result.object,
    })

    const tips: PreparationSteps = result.object

    // During a locale rollback the prompt ran in English while the household
    // still stores the rolled-back locale. Caching would leave English steps
    // under that locale once it is back, so serve them uncached (HON-921).
    if (locale === household.locale) {
      await saveRecipeSteps({ mealId, locale, servings, inputHash }, tips)
    }

    return NextResponse.json({ tips }, { status: 200 })
  } catch (error) {
    if (error instanceof RecipeStepsError) {
      return NextResponse.json(errorBody('Meal not found', 'meal_not_found'), { status: 404 })
    }

    captureApiError(error, {
      route: '/api/meals/[id]/preparation-steps',
      userId: session.user.id,
      feature: 'preparation_tips',
    })

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
      return NextResponse.json(errorBody('Request timed out. Please try again.', 'tips_timeout'), {
        status: 504,
      })
    }

    return NextResponse.json(errorBody("Couldn't generate tips. Try again.", 'tips_failed'), {
      status: 500,
    })
  }
}

/**
 * Platform execution ceiling for this route, in seconds: the AbortSignal
 * budget above only holds if the platform lets the function run that long.
 * 60 is the value every Vercel plan allows (HON-693).
 */
export const maxDuration = 60

export const POST = withRequestId(handlePOST)
