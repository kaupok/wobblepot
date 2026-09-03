import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { TIPS_MODEL } from '@/lib/ai/models'
import {
  buildFullTipsPrompt,
  buildSupplementaryTipsPrompt,
  fullTipsSchema,
  supplementaryTipsSchema,
} from '@/lib/ai/preparation-tips'
import { parseStoredTips } from '@/lib/tips'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'
import { logAiSample } from '@/lib/ai/sampling'
import {
  AiCostCapExceededError,
  assertUnderCap,
  recordAiUsage,
  respondCapExceeded,
} from '@/lib/ai/usage'
import { withRequestId } from '@/lib/request-id'
import { captureApiError } from '@/lib/errors'
import { getEffectiveServings } from '@/lib/meal-planning/servings'
import type { StructuredTips } from '@/components/meal-plan/types'

function getErrorStatusCode(err: unknown): number | undefined {
  if (err !== null && typeof err === 'object') {
    const e = err as Record<string, unknown>
    if (typeof e['statusCode'] === 'number') return e['statusCode']
    if (typeof e['status'] === 'number') return e['status']
  }
  return undefined
}

async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const { household } = membership
  const { id: planId, entryId } = await params

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
            components: {
              include: {
                ingredient: {
                  select: {
                    name: true,
                    defaultUnit: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    }

    if (!entry.meal) {
      return NextResponse.json({ error: 'No meal assigned to this entry' }, { status: 400 })
    }

    // Return cached tips if available and valid JSON
    if (entry.preparationTips) {
      const cached = parseStoredTips(entry.preparationTips)
      if (cached) {
        return NextResponse.json({ tips: cached }, { status: 200 })
      }
      // Old format — fall through to regenerate
    }

    // Gate after the cache hit: cached reads shouldn't burn rate-limit tokens,
    // only AI calls should. Modal reopens on a cached entry are free.
    const rateLimitResult = await checkRateLimit(household.id, 'meal-prep-tips')
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          message: `Maximum ${rateLimitResult.limit} preparation tip requests per hour`,
          resetAt: rateLimitResult.resetAt.toISOString(),
        },
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSeconds(rateLimitResult)) },
        },
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

    // Scale by the entry's own serving count, not the raw member count: the
    // tips are cached onto the entry, so a dinner with `servingOverride: 6` in
    // a household of 2 would otherwise get timings and pan sizes for a third
    // of the food the card, pantry and shopping list all agree on (HON-614).
    const effectiveServings = getEffectiveServings(entry, household._count.members)
    const mealName = entry.meal.name
    const timeMinutes = entry.meal.timeMinutes
    const preparationNotes = entry.meal.preparationNotes

    const ingredientsList = entry.meal.components
      .map((comp) => {
        const quantity = comp.quantityPerServing * effectiveServings
        const unit = comp.ingredient.defaultUnit === 'piece' ? 'pcs' : comp.ingredient.defaultUnit
        return `- ${comp.ingredient.name}: ${Math.round(quantity)}${unit}`
      })
      .join('\n')

    const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })
    const timeout = AbortSignal.timeout(30_000)

    let tips: StructuredTips

    if (preparationNotes && preparationNotes.trim()) {
      const prompt = buildSupplementaryTipsPrompt({
        mealName,
        householdSize: effectiveServings,
        timeMinutes,
        ingredientsList,
        preparationNotes,
        locale: household.locale,
      })

      const result = await generateObject({
        model: anthropic(TIPS_MODEL),
        schema: supplementaryTipsSchema,
        prompt,
        maxOutputTokens: 400,
        maxRetries: 3,
        abortSignal: timeout,
      })

      await recordAiUsage({
        householdId: household.id,
        feature: 'entry_preparation_tips',
        model: TIPS_MODEL,
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
      })

      await logAiSample({
        callSite: 'preparation-tips-supplementary',
        locale: household.locale,
        input: {
          mealName,
          householdSize: effectiveServings,
          timeMinutes,
          ingredientsCount: entry.meal.components.length,
          hasUserNotes: true,
        },
        output: result.object,
      })

      tips = result.object
    } else {
      const prompt = buildFullTipsPrompt({
        mealName,
        householdSize: effectiveServings,
        timeMinutes,
        ingredientsList,
        locale: household.locale,
      })

      const result = await generateObject({
        model: anthropic(TIPS_MODEL),
        schema: fullTipsSchema,
        prompt,
        maxOutputTokens: 1000,
        maxRetries: 3,
        abortSignal: timeout,
      })

      await recordAiUsage({
        householdId: household.id,
        feature: 'entry_preparation_tips',
        model: TIPS_MODEL,
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
      })

      await logAiSample({
        callSite: 'preparation-tips-full',
        locale: household.locale,
        input: {
          mealName,
          householdSize: effectiveServings,
          timeMinutes,
          ingredientsCount: entry.meal.components.length,
          hasUserNotes: false,
        },
        output: result.object,
      })

      tips = result.object
    }

    // Cache tips as JSON in the database
    await prisma.mealPlanEntry.update({
      where: { id: entryId },
      data: { preparationTips: JSON.stringify(tips) },
    })

    return NextResponse.json({ tips }, { status: 200 })
  } catch (error) {
    captureApiError(error, {
      route: '/api/meal-plans/[id]/entries/[entryId]/preparation-tips',
      userId: session.user.id,
      feature: 'preparation_tips',
    })

    // Classify error for appropriate HTTP status
    const statusCode = getErrorStatusCode(error)

    if (statusCode === 429) {
      return NextResponse.json(
        { error: 'AI service is busy. Please try again in a moment.' },
        { status: 429 },
      )
    }

    if (statusCode === 529 || statusCode === 503) {
      return NextResponse.json(
        { error: 'AI service temporarily unavailable. Please try again.' },
        { status: 502 },
      )
    }

    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json({ error: 'Request timed out. Please try again.' }, { status: 504 })
    }

    return NextResponse.json({ error: "Couldn't generate tips. Try again." }, { status: 500 })
  }
}

export const POST = withRequestId(handlePOST)
