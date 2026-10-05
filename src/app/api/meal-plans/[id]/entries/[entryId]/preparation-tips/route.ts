import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { isAiBudgetTimeout } from '@/lib/ai/timeout'
import { aiErrorStatusCode } from '@/lib/ai/error-status'
import { auth } from '@/lib/auth'
import { getHouseholdMembership, loadHouseholdServings } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { TIPS_MODEL } from '@/lib/ai/models'
import { TIPS_AI_BUDGET_MS } from '@/lib/ai/budgets'
import { buildFullTipsRequest, buildSupplementaryTipsRequest } from '@/lib/ai/preparation-tips'
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
  withUsageOnFailure,
} from '@/lib/ai/usage'
import { withRequestId } from '@/lib/request-id'
import { captureApiError } from '@/lib/errors'
import { getEffectiveServings, sumPortions } from '@/lib/meal-planning/servings'
import {
  ingredientTranslationsInclude,
  mealTranslationsInclude,
  translateIngredient,
  translateMeal,
} from '@/lib/i18n/content'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import type { StructuredTips } from '@/components/meal-plan/types'
import type { PreparationTipsErrorCode } from '@/lib/ai/error-codes'

/**
 * `code` is what `useMealTips` renders from, via `PREPARATION_TIPS_ERROR_KEYS`;
 * `error` is English and stays in the body for logs only (HON-888).
 */
function errorBody(error: string, code: PreparationTipsErrorCode) {
  return { error, code }
}

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

  const { household } = membership
  const { id: planId, entryId } = await params
  // Which translation rows feed the prompt, and the prompt's own language.
  // Resolved, so a locale rolled back out of KNOWN_LOCALES gets English names
  // and an English prompt (HON-921). The cache guard below still compares the
  // stored `household.locale`, which is what a locale PATCH moves.
  const locale = resolveHouseholdLocale(household)

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

    // Kill-switch, placed as in `/api/meal-plans/generate`, and after the cache
    // hit above so stored tips are still served while it is off. `code` is what
    // `useMealTips` keys on to skip its retry and show catalog copy.
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

    // Scale by the entry's own serving count, not the raw member count: the
    // tips are cached onto the entry, so a dinner with `servingOverride: 6` in
    // a household of 2 would otherwise get timings and pan sizes for a third
    // of the food the card, pantry and shopping list all agree on (HON-614).
    // Without an override it is the members' portions summed (HON-1040).
    const servingsWhenPriced = sumPortions(household.members)
    const effectiveServings = getEffectiveServings(entry, servingsWhenPriced)
    // The prompt reads the household's names and notes, not the English ones:
    // given English inputs the model translates them itself, and its ingredient
    // names then differ from the Estonian ones the same modal shows, while the
    // supplementary mode would build on notes the user never read (HON-913).
    // The translated notes fall back to the English ones per field.
    //
    // A translation row is not covered by the `meal.updatedAt` cache guard
    // below: editing one does not bump the meal, so tips cached from the old
    // translation stay. Accepted, because translations are seed-managed.
    const shownMeal = translateMeal(entry.meal, locale)
    const mealName = shownMeal.name
    const timeMinutes = entry.meal.timeMinutes
    const preparationNotes = shownMeal.preparationNotes

    const components = entry.meal.components.map((comp) => ({
      name: translateIngredient(comp.ingredient, locale).name,
      quantityPerServing: comp.quantityPerServing,
      defaultUnit: comp.ingredient.defaultUnit,
    }))

    const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })
    // One wall-clock budget for all AI time in this request, shared by the
    // initial attempt and every retry. Sized against `maxDuration` in `@/lib/ai/budgets`.
    const timeout = AbortSignal.timeout(TIPS_AI_BUDGET_MS)

    let tips: StructuredTips

    if (preparationNotes && preparationNotes.trim()) {
      const request = buildSupplementaryTipsRequest({
        mealName,
        servings: effectiveServings,
        timeMinutes,
        components,
        preparationNotes,
        locale,
      })

      const startedAt = Date.now()
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
            ...request,
            model: anthropic(TIPS_MODEL),
            abortSignal: timeout,
          }),
      )

      await recordAiUsage({
        householdId: household.id,
        feature: 'entry_preparation_tips',
        ...toAiUsageStats(TIPS_MODEL, result.usage, Date.now() - startedAt),
      })

      await logAiSample({
        callSite: 'preparation-tips-supplementary',
        locale,
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
      const request = buildFullTipsRequest({
        mealName,
        servings: effectiveServings,
        timeMinutes,
        components,
        locale,
      })

      const startedAt = Date.now()
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
            ...request,
            model: anthropic(TIPS_MODEL),
            abortSignal: timeout,
          }),
      )

      await recordAiUsage({
        householdId: household.id,
        feature: 'entry_preparation_tips',
        ...toAiUsageStats(TIPS_MODEL, result.usage, Date.now() - startedAt),
      })

      await logAiSample({
        callSite: 'preparation-tips-full',
        locale,
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
    // handler, and generation takes up to 45s; a swap, a `servingOverride`, a
    // locale PATCH or an edit to the meal itself that commits in the meantime
    // nulls this cache precisely because one of those inputs moved (HON-681,
    // HON-683).
    // An unconditional write would put the stale tips straight back, and every
    // later read is a cache hit (above) — so the entry would keep pan sizes for
    // a count nobody is cooking, permanently rather than for one request.
    //
    // Same trick the entry PATCH uses for the same class of ordering problem
    // (`servingsWritableWhere` and its `updateManyAndReturn` claims):
    // `updateMany` matches nothing when an input moved, and writes nothing.
    // The caller still gets the tips it asked for — only the cache is guarded.
    //
    // The household's servings are a further priced-from input, because
    // `getEffectiveServings` above falls back to them whenever the entry
    // carries no `servingOverride` — the default state of an entry. They are
    // the members' portions summed, so a member joining or leaving and a
    // portion change both move them (HON-1040). They cannot join the `where`
    // below: Prisma has no filter for an aggregate over a relation. And the
    // invalidation on those writes cannot cover this gap from its side either —
    // a row that is mid-generation holds `preparationTips: null`, which is
    // exactly what `invalidateFutureEntryTips`'s `preparationTips: { not: null }`
    // clause excludes, so its `updateMany` matches zero rows and this write
    // would then put tips for the old household servings back permanently
    // (HON-684). So re-read the servings and skip the write if they moved.
    //
    // This closes the 45s window to the microseconds between the read and the
    // write, which is the same residual exposure every input pinned in the
    // `where` below carries — parity with them is the bar, not elimination.
    // HON-681 recorded the one-request window as accepted.
    const servingsNow =
      entry.servingOverride !== null
        ? // An override priced the prompt, so the household's servings never
          // entered it and there is nothing to re-check.
          servingsWhenPriced
        : await loadHouseholdServings(household.id)

    if (servingsNow !== servingsWhenPriced) {
      return NextResponse.json({ tips }, { status: 200 })
    }

    // During a locale rollback the household still stores a locale that is no
    // longer in KNOWN_LOCALES, and this prompt ran in English. The cache guard
    // below compares the stored value, which a rollback does not move, so
    // caching here would leave English tips on the entry after the locale is
    // re-enabled, with nothing to clear them. Serve them uncached instead; the
    // next open regenerates through the rate-limited path (HON-921).
    if (locale !== household.locale) {
      return NextResponse.json({ tips }, { status: 200 })
    }

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
        // `PATCH /api/households/me/meals/[id]` is the fourth writer that
        // nulls this cache, and it moves the meal's *contents* — name, time,
        // notes, components — while `mealId` stays put, so none of the fields
        // above would notice. `Meal.updatedAt` is `@updatedAt` and that route
        // calls `meal.update` unconditionally, so it moves on every such edit
        // and is the one field that does (HON-683). A meal edit the prompt
        // does not read (a `sourceUrl` fix) bumps it too and discards this
        // write — the caller still gets its tips, and the next open
        // regenerates.
        meal: { is: { updatedAt: entry.meal.updatedAt } },
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

    // Same two-name check as the other AI routes: a budget that fires during
    // ai@7's retry sleep surfaces as `AbortError`, not `TimeoutError`, and
    // would otherwise fall through to the 500 below (HON-694).
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
 * Platform execution ceiling for this route, in seconds.
 *
 * Stated explicitly because the AbortSignal budget inside `handlePOST` is only
 * meaningful if the platform lets the function run that long — otherwise the
 * request is killed first and the friendly 504 above never runs. 60 is the
 * value every Vercel plan allows, so this cannot fail to deploy (HON-693).
 */
export const maxDuration = 60

export const POST = withRequestId(handlePOST)
