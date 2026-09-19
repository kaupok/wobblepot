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
  toAiUsageStats,
  withUsageOnFailure,
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
    // One wall-clock budget for all AI time in this request, shared by the
    // initial attempt and every `maxRetries` retry below — not a per-attempt
    // timeout. It is the real bound on retries: `maxRetries: 3` permits four
    // attempts, but how many actually fit depends on how each one fails. A
    // fast failure (429, 5xx) costs well under a second, so those still retry
    // freely; a slow generation does not.
    //
    // Sonnet 5's adaptive thinking made a single hard-meal generation take up
    // to 21s (measured, HON-693), so at the old 30s a slow first attempt left
    // no room for even one retry — the call aborted and the user got a 504
    // instead of the tips the larger token ceilings were meant to buy. 45s
    // covers two worst-case attempts plus ai@7's ~2s backoff (~45s), and
    // leaves 15s under the 60s `maxDuration` for the DB reads before this
    // point and the writes after it, so the 504 branch below stays reachable
    // rather than the platform killing the function first.
    const timeout = AbortSignal.timeout(45_000)

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

      const result = await withUsageOnFailure(
        TIPS_MODEL,
        (stats) =>
          recordAiUsage({
            householdId: household.id,
            feature: 'entry_preparation_tips',
            ...stats,
          }),
        () =>
          generateObject({
            model: anthropic(TIPS_MODEL),
            schema: supplementaryTipsSchema,
            prompt,
            // Sized for Sonnet 5's adaptive thinking (HON-693): reasoning
            // tokens are billed as output and count against this cap, so the
            // old 400 was not a tips-sized budget any more. Measured against
            // a deliberately hard meal, this call reached 593 output tokens
            // (335 of them reasoning) and truncated outright at 400 —
            // `finish: 'length'`, then NoObjectGeneratedError and no tips for
            // the user. This is a ceiling, not a target: a typical call still
            // returns in ~195 tokens.
            maxOutputTokens: 1200,
            maxRetries: 3,
            abortSignal: timeout,
          }),
      )

      await recordAiUsage({
        householdId: household.id,
        feature: 'entry_preparation_tips',
        ...toAiUsageStats(TIPS_MODEL, result.usage),
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

      const result = await withUsageOnFailure(
        TIPS_MODEL,
        (stats) =>
          recordAiUsage({
            householdId: household.id,
            feature: 'entry_preparation_tips',
            ...stats,
          }),
        () =>
          generateObject({
            model: anthropic(TIPS_MODEL),
            schema: fullTipsSchema,
            prompt,
            // Same adaptive-thinking headroom as the supplementary call above
            // (HON-693). The full schema is larger, and on the same hard meal
            // this reached 892 output tokens (330 reasoning) — 89% of the old
            // 1000, close enough to truncation to move.
            maxOutputTokens: 2000,
            maxRetries: 3,
            abortSignal: timeout,
          }),
      )

      await recordAiUsage({
        householdId: household.id,
        feature: 'entry_preparation_tips',
        ...toAiUsageStats(TIPS_MODEL, result.usage),
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

    // Cache tips as JSON in the database — but only while the inputs they were
    // priced from still hold. This prompt was built from `entry.meal`,
    // `entry.servingOverride` and `household.locale` as read at the top of the
    // handler, and generation takes up to 45s; a swap, a `servingOverride` or a
    // locale PATCH that commits in the meantime nulls this cache precisely
    // because one of those inputs moved (HON-681).
    // An unconditional write would put the stale tips straight back, and every
    // later read is a cache hit (above) — so the entry would keep pan sizes for
    // a count nobody is cooking, permanently rather than for one request.
    //
    // Same trick the entry PATCH uses for the same class of ordering problem
    // (`servingsWritableWhere` and its `updateManyAndReturn` claims):
    // `updateMany` matches nothing when an input moved, and writes nothing.
    // The caller still gets the tips it asked for — only the cache is guarded.
    await prisma.mealPlanEntry.updateMany({
      where: {
        id: entryId,
        // A swap is the third writer that nulls this cache, and it resets
        // `servingOverride` to null — which is what the common entry already
        // stores, so the count alone would still match and the old meal's tips
        // would land on the new one.
        mealId: entry.mealId,
        servingOverride: entry.servingOverride,
        plan: { household: { locale: household.locale } },
      },
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

/**
 * Platform execution ceiling for this route, in seconds.
 *
 * Stated explicitly because the AbortSignal budget inside `handlePOST` is only
 * meaningful if the platform lets the function run that long — otherwise the
 * request is killed first and the friendly 504 above never runs. 60 is the
 * value every Vercel plan allows, so this cannot fail to deploy (HON-693).
 */
export const maxDuration = 60

export const POST = withRequestId(handlePOST)
