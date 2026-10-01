import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { generateMealPlan, createEmptyPlan } from '@/lib/ai/generate-plan'
import { fillEmptySlots } from '@/lib/ai/fill-plan'
import {
  MealPlanValidationError,
  InsufficientCandidatesError,
  NoEmptySlotsError,
} from '@/lib/ai/types'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'
import {
  AiCostCapExceededError,
  assertUnderCap,
  recordAiUsage,
  respondCapExceeded,
} from '@/lib/ai/usage'
import { withRequestId } from '@/lib/request-id'
import { getServerFlag } from '@/lib/feature-flags'
import { captureApiError } from '@/lib/errors'
import { isAiBudgetTimeout } from '@/lib/ai/timeout'
import type { MealPlanGenerateErrorCode } from '@/lib/ai/error-codes'
// This route's AI budget and its sizing against `maxDuration` live in `@/lib/ai/budgets`.
import { PLAN_AI_BUDGET_MS } from '@/lib/ai/budgets'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'

const datePattern = /^\d{4}-\d{2}-\d{2}$/

const generateRequestSchema = z.object({
  startDate: z.string().regex(datePattern, 'Date must be in YYYY-MM-DD format'),
  endDate: z.string().regex(datePattern, 'Date must be in YYYY-MM-DD format'),
  planId: z.string().optional(),
  mode: z.enum(['generate', 'empty', 'fill-empty']).default('generate'),
})

/** Maximum number of days allowed in a single generation request. */
const MAX_DAYS = 14

/**
 * Every error body carries a `code` from `MealPlanGenerateErrorCode` (HON-725).
 * `FirstTimeSetup` and `FillDaysAction` render a translation keyed on it; the
 * `error` / `message` prose is English and stays only for logs and breadcrumbs.
 */
function errorJson(
  code: MealPlanGenerateErrorCode,
  body: Record<string, unknown>,
  init: ResponseInit,
): NextResponse {
  return NextResponse.json({ code, ...body }, init)
}

async function handlePOST(request: Request) {
  // Auth check
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return errorJson('unauthorized', { error: 'Unauthorized' }, { status: 401 })
  }

  // Get household membership
  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return errorJson('no_household', { error: 'No household found' }, { status: 404 })
  }

  const { household } = membership
  // Resolved once: a locale rolled back out of KNOWN_LOCALES reads as English
  // for content and the AI prompt alike (HON-921).
  const locale = resolveHouseholdLocale(household)

  const rateLimitResult = await checkRateLimit(household.id, 'plan-generation')
  if (!rateLimitResult.allowed) {
    return errorJson(
      'rate_limited',
      {
        error: 'Rate limit exceeded',
        message: `Maximum ${rateLimitResult.limit} meal plan generations per hour`,
        resetAt: rateLimitResult.resetAt.toISOString(),
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds(rateLimitResult)) },
      },
    )
  }

  // Kill-switch: short-circuit before the cost-cap query and the AI call so a
  // disabled feature does no expensive work. Fail-open default (`true`) keeps
  // the route working through PostHog outages — see docs/FEATURE_FLAGS.md.
  const aiEnabled = await getServerFlag('ai_generation_enabled', session.user.id)
  if (!aiEnabled) {
    return errorJson(
      'generation_disabled',
      {
        error: 'AI generation is temporarily disabled',
        message: 'AI plan generation is currently turned off. Please try again later.',
      },
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

  // Parse and validate request body
  let body: unknown = {}
  try {
    const text = await request.text()
    if (text) {
      body = JSON.parse(text)
    }
  } catch {
    return errorJson('invalid_request', { error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = generateRequestSchema.safeParse(body)
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors
    return errorJson(
      'invalid_request',
      { error: 'Validation failed', details: errors },
      { status: 400 },
    )
  }

  const { mode = 'generate', planId } = parsed.data

  // Parse dates
  const startDate = parseLocalDate(parsed.data.startDate)
  const endDate = parseLocalDate(parsed.data.endDate)

  // Validate date range
  if (endDate <= startDate) {
    return errorJson(
      'invalid_request',
      { error: 'endDate must be after startDate' },
      { status: 400 },
    )
  }

  const dayCount = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
  if (dayCount > MAX_DAYS) {
    return errorJson(
      'invalid_request',
      { error: `Date range cannot exceed ${MAX_DAYS} days` },
      { status: 400 },
    )
  }

  // Get household preferences
  const preferences = household.preferences
  const dietaryType = preferences?.dietaryType ?? null
  const allergensToAvoid = preferences?.allergensToAvoid ?? []
  const excludedIngredientIds = preferences?.excludedIngredientIds ?? []
  const restrictions = preferences?.restrictions ?? []
  const weekdayMealTypes = preferences?.weekdayMealTypes ?? ['dinner']
  const weekendMealTypes = preferences?.weekendMealTypes ?? ['dinner']

  // Handle fill-empty mode
  if (mode === 'fill-empty') {
    if (!planId) {
      return errorJson(
        'invalid_request',
        { error: 'planId is required for fill-empty mode' },
        { status: 400 },
      )
    }

    try {
      const result = await fillEmptySlots({
        aiBudgetMs: PLAN_AI_BUDGET_MS,
        planId,
        householdId: household.id,
        startDate,
        endDate,
        dietaryType,
        allergensToAvoid,
        excludedIngredientIds,
        restrictions,
        locale,
        weekdayMealTypes,
        weekendMealTypes,
        onAiUsage: (usage) =>
          recordAiUsage({ householdId: household.id, feature: 'plan_fill_empty', ...usage }),
      })

      return NextResponse.json(result, { status: 200 })
    } catch (error) {
      if (error instanceof NoEmptySlotsError) {
        return errorJson(
          'no_empty_slots',
          { error: 'No empty slots to fill', message: error.message },
          { status: 400 },
        )
      }

      if (error instanceof MealPlanValidationError) {
        captureApiError(error, {
          route: '/api/meal-plans/generate',
          userId: session.user.id,
          feature: 'plan_fill_empty',
          householdId: household.id,
        })
        return errorJson(
          'invalid_plan',
          { error: 'AI generated an invalid meal plan', message: error.message },
          { status: 422 },
        )
      }

      if (error instanceof InsufficientCandidatesError) {
        return errorJson(
          'insufficient_candidates',
          { error: 'Insufficient meal options', message: error.message },
          { status: 422 },
        )
      }

      if (error instanceof Error && error.message === 'Plan not found') {
        return errorJson('plan_not_found', { error: 'Plan not found' }, { status: 404 })
      }

      captureApiError(error, {
        route: '/api/meal-plans/generate',
        userId: session.user.id,
        feature: 'plan_fill_empty',
        householdId: household.id,
      })

      // Reported before it is classified, as the reference route does: a
      // timeout is user-facing but it also means the budget above is
      // mis-sized, which is exactly what should show up in Sentry.
      if (isAiBudgetTimeout(error)) {
        return errorJson(
          'generation_timeout',
          {
            error: 'Request timed out',
            message: 'Filling the empty days took too long. Please try again.',
          },
          { status: 504 },
        )
      }

      return errorJson(
        'generation_failed',
        { error: 'Failed to fill empty slots' },
        { status: 500 },
      )
    }
  }

  // Handle empty mode - create plan with no entries
  if (mode === 'empty') {
    try {
      const result = await createEmptyPlan({
        householdId: household.id,
        startDate,
        endDate,
      })

      return NextResponse.json(result, { status: 200 })
    } catch (error) {
      captureApiError(error, {
        route: '/api/meal-plans/generate',
        userId: session.user.id,
        feature: 'plan_empty',
        householdId: household.id,
      })
      return errorJson(
        'generation_failed',
        { error: 'Failed to create empty plan' },
        { status: 500 },
      )
    }
  }

  try {
    // Generate meal plan (default mode)
    const result = await generateMealPlan({
      aiBudgetMs: PLAN_AI_BUDGET_MS,
      householdId: household.id,
      startDate,
      endDate,
      dietaryType,
      allergensToAvoid,
      excludedIngredientIds,
      restrictions,
      locale,
      weekdayMealTypes,
      weekendMealTypes,
      onAiUsage: (usage) =>
        recordAiUsage({ householdId: household.id, feature: 'plan_generate', ...usage }),
    })

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    // Handle validation errors from AI response
    if (error instanceof MealPlanValidationError) {
      captureApiError(error, {
        route: '/api/meal-plans/generate',
        userId: session.user.id,
        feature: 'plan_generate',
        householdId: household.id,
      })
      return errorJson(
        'invalid_plan',
        { error: 'AI generated an invalid meal plan', message: error.message },
        { status: 422 },
      )
    }

    // Handle insufficient candidates for required protein slots
    if (error instanceof InsufficientCandidatesError) {
      return errorJson(
        'insufficient_candidates',
        { error: 'Insufficient meal options', message: error.message },
        { status: 422 },
      )
    }

    captureApiError(error, {
      route: '/api/meal-plans/generate',
      userId: session.user.id,
      feature: 'plan_generate',
      householdId: household.id,
    })

    // Reported before it is classified, as the reference route does: a timeout
    // is user-facing but it also means the budget above is mis-sized, which is
    // exactly what should show up in Sentry.
    if (isAiBudgetTimeout(error)) {
      return errorJson(
        'generation_timeout',
        {
          error: 'Request timed out',
          message: 'Generating the plan took too long. Please try again.',
        },
        { status: 504 },
      )
    }

    return errorJson(
      'generation_failed',
      { error: 'Failed to generate meal plan' },
      { status: 500 },
    )
  }
}

export const POST = withRequestId(handlePOST)

/**
 * Platform execution ceiling for this route, in seconds.
 *
 * Stated explicitly because `PLAN_AI_BUDGET_MS` is only meaningful if the platform
 * lets the function run that long — otherwise the request is killed first and
 * the friendly 504s above never run. 60 is the value every Vercel plan allows,
 * so this cannot fail to deploy (HON-693).
 *
 * The two client callers of this route must outlast it, or they abort work the
 * household has already been billed for — see `CLIENT_TIMEOUT_MS` in
 * `src/components/timeline/FirstTimeSetup.tsx` and `FillDaysAction.tsx`.
 */
export const maxDuration = 60
