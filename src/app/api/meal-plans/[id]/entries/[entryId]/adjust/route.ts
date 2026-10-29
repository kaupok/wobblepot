import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { ADJUST_AI_BUDGET_MS } from '@/lib/ai/budgets'
import type { AdjustRecipeErrorCode } from '@/lib/ai/error-codes'
import { aiErrorStatusCode } from '@/lib/ai/error-status'
import { isAiBudgetTimeout } from '@/lib/ai/timeout'
import { AiCostCapExceededError, assertUnderCap, respondCapExceeded } from '@/lib/ai/usage'
import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getServerFlag } from '@/lib/feature-flags'
import { getHouseholdMembership } from '@/lib/household'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import {
  AdjustEntryError,
  type AdjustEntryRefusal,
  loadAdjustContext,
  proposeAdjustment,
} from '@/lib/meal-planning/adjust-entry'
import { ADJUST_INSTRUCTION_MAX_LENGTH } from '@/lib/meal-planning/components-schema'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'
import { withRequestId } from '@/lib/request-id'

/**
 * `code` is what `useAdjustRecipe` renders from, via `ADJUST_RECIPE_ERROR_KEYS`;
 * `error` is English and stays in the body for logs only (HON-888).
 */
function errorBody(error: string, code: AdjustRecipeErrorCode) {
  return { error, code }
}

const REFUSALS: Record<
  AdjustEntryRefusal,
  { status: number; error: string; code: AdjustRecipeErrorCode }
> = {
  not_found: { status: 404, error: 'Entry not found', code: 'entry_not_found' },
  no_meal: { status: 400, error: 'No meal assigned to this entry', code: 'no_meal' },
  not_planned: { status: 409, error: 'Only a planned meal can be changed', code: 'not_planned' },
}

const bodySchema = z.object({
  instruction: z.string().trim().min(1).max(ADJUST_INSTRUCTION_MAX_LENGTH),
})

/**
 * "Adjust recipe" (HON-1244): proposes ingredient changes to one planned entry
 * from the household's instruction. Writes nothing: the household reviews the
 * proposals and applies the ones it keeps with `PUT .../components`. Guards
 * are placed as in the cook-question route.
 */
async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json(errorBody('Unauthorized', 'unauthorized'), { status: 401 })
  }

  const membership = await getHouseholdMembership(session.user.id)
  if (!membership) {
    return NextResponse.json(errorBody('No household found', 'no_household'), { status: 404 })
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(errorBody('Invalid instruction', 'invalid_instruction'), {
      status: 400,
    })
  }

  const { household } = membership
  const { id: planId, entryId } = await params
  // Resolved, so a locale rolled back out of KNOWN_LOCALES gets English names
  // and an English prompt (HON-921). Nothing is cached, so nothing to guard.
  const locale = resolveHouseholdLocale(household)

  try {
    const context = await loadAdjustContext(household.id, planId, entryId, locale)

    const rateLimitResult = await checkRateLimit(household.id, 'adjust-recipe')
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          ...errorBody('Rate limit exceeded', 'rate_limited'),
          message: `Maximum ${rateLimitResult.limit} recipe adjustments per hour`,
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
      if (error instanceof AiCostCapExceededError) return respondCapExceeded(error)
      throw error
    }

    // One wall-clock budget for all AI time in this request, shared by every
    // retry. Sized against `maxDuration` in `@/lib/ai/budgets`.
    const result = await proposeAdjustment({
      household,
      context,
      instruction: parsed.data.instruction,
      locale,
      abortSignal: AbortSignal.timeout(ADJUST_AI_BUDGET_MS),
    })
    return NextResponse.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof AdjustEntryError) {
      const { status, error: message, code } = REFUSALS[error.reason]
      return NextResponse.json(errorBody(message, code), { status })
    }

    captureApiError(error, {
      route: '/api/meal-plans/[id]/entries/[entryId]/adjust',
      userId: session.user.id,
      feature: 'adjust_recipe',
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
      return NextResponse.json(
        errorBody('Request timed out. Please try again.', 'adjust_timeout'),
        {
          status: 504,
        },
      )
    }
    return NextResponse.json(errorBody("Couldn't suggest changes. Try again.", 'adjust_failed'), {
      status: 500,
    })
  }
}

/**
 * Platform execution ceiling for this route, in seconds. Stated so the
 * `ADJUST_AI_BUDGET_MS` budget and its 504 stay reachable (HON-693).
 */
export const maxDuration = 60

export const POST = withRequestId(handlePOST)
