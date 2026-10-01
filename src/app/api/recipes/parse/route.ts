import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { parseAndMatchRecipe } from '@/lib/ai/parse-recipe'
import { translateMatchResults } from '@/lib/ai/translate-match-results'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { fetchRecipeFromUrl } from '@/lib/ai/recipe-fetch'
import { RecipeParseError } from '@/lib/ai/recipe-errors'
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
import type { RecipeImportErrorCode } from '@/lib/ai/error-codes'
// This route's AI budget and its sizing against `maxDuration` live in `@/lib/ai/budgets`.
import {
  RECIPE_PARSE_AFTER_URL_FETCH_AI_BUDGET_MS,
  RECIPE_PARSE_AI_BUDGET_MS,
} from '@/lib/ai/budgets'

/**
 * Failure body for this route: English prose for logs and Sentry breadcrumbs,
 * plus the machine-readable `code` the client translates (HON-700). Every
 * error response *this handler builds* goes through here, so no branch of it
 * can ship without a code. The one failure it does not build is the shared AI
 * cost-cap 429, which `respondCapExceeded` (`src/lib/ai/usage.ts`) returns
 * whole — it carries its own `ai_cap_exceeded` code.
 */
function errorBody(error: string, code: RecipeImportErrorCode) {
  return { success: false as const, error, code }
}

const parseRecipeSchema = z.object({
  text: z.string().min(1, 'Recipe text is required'),
})

/**
 * `Retry-After` for a `provider_unavailable` 503. The SDK has already retried
 * with backoff inside the request, so an immediate retry would most likely
 * fail the same way; half a minute is long enough for a transient overload to
 * clear without leaving the household waiting on a hard outage.
 */
const PROVIDER_RETRY_AFTER_SECONDS = 30

/**
 * Detect if the input starts with a URL and extract it along with optional user context.
 */
export function extractUrlAndContext(text: string): { url: string; context: string } | null {
  let trimmed = text.trim()
  // Support www. URLs by auto-prepending https://
  if (trimmed.startsWith('www.')) {
    trimmed = 'https://' + trimmed
  }
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return null
  }
  const lines = trimmed.split('\n')
  const urlLine = lines[0]!.trim()
  // Validate it looks like a URL (has a domain after the protocol)
  try {
    new URL(urlLine)
  } catch {
    return null
  }
  const context = lines.slice(1).join('\n').trim()
  return { url: urlLine, context }
}

async function handlePOST(request: Request) {
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

  const rateLimitResult = await checkRateLimit(membership.household.id, 'recipe-parse')
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        ...errorBody('Rate limit exceeded', 'rate_limited'),
        message: `Maximum ${rateLimitResult.limit} recipe parses per hour`,
        resetAt: rateLimitResult.resetAt.toISOString(),
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds(rateLimitResult)) },
      },
    )
  }

  // Kill-switch: short-circuit recipe import (the highest-risk external-input
  // surface — SSRF, parser crashes, non-recipe content) before the AI call.
  // Fail-open default (`true`) keeps the route working through PostHog
  // outages — see docs/FEATURE_FLAGS.md. `ai_generation_enabled` stops every
  // model call, this one included, so either flag being off disables import.
  const [recipeImportEnabled, aiEnabled] = await Promise.all([
    getServerFlag('recipe_import_enabled', session.user.id),
    getServerFlag('ai_generation_enabled', session.user.id),
  ])
  if (!recipeImportEnabled || !aiEnabled) {
    return NextResponse.json(
      {
        ...errorBody('Recipe import is temporarily disabled', 'import_disabled'),
        message: 'Recipe import is currently turned off. Please try again later.',
      },
      { status: 503 },
    )
  }

  try {
    await assertUnderCap(membership.household.id)
  } catch (error) {
    if (error instanceof AiCostCapExceededError) {
      return respondCapExceeded(error)
    }
    throw error
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(errorBody('Invalid JSON', 'invalid_request'), { status: 400 })
  }

  const parsed = parseRecipeSchema.safeParse(body)

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors
    return NextResponse.json(
      { ...errorBody('Validation failed', 'invalid_request'), details: errors },
      { status: 400 },
    )
  }

  try {
    let recipeText = parsed.data.text
    let sourceUrl: string | undefined

    // Check if input is a URL
    const urlInput = extractUrlAndContext(recipeText)
    if (urlInput) {
      sourceUrl = urlInput.url
      const fetchedContent = await fetchRecipeFromUrl(urlInput.url)
      // Combine fetched content with optional user context
      recipeText = urlInput.context
        ? `${fetchedContent}\n\nAdditional context from user: ${urlInput.context}`
        : fetchedContent
    }

    // The parser runs in the household's resolved locale. The
    // `FEATURE_RECIPE_PARSER_ET` gate (HON-502) is retired since HON-506 seeded
    // Estonian ingredient translations: every `KNOWN_LOCALES` value has
    // translation coverage. Resolving rather than threading the raw value means
    // a locale rolled back out of `KNOWN_LOCALES` parses in English (HON-921).
    const parserLocale = resolveHouseholdLocale(membership.household)

    const result = await parseAndMatchRecipe(
      recipeText,
      sourceUrl,
      (usage) =>
        recordAiUsage({
          householdId: membership.household.id,
          feature: 'recipe_parse',
          ...usage,
        }),
      { householdId: membership.household.id, locale: parserLocale },
      // Started here, after any URL fetch above, so the budget covers AI time
      // only. `sourceUrl` is set exactly when that fetch ran, so it is also
      // the test for which budget applies.
      AbortSignal.timeout(
        sourceUrl ? RECIPE_PARSE_AFTER_URL_FETCH_AI_BUDGET_MS : RECIPE_PARSE_AI_BUDGET_MS,
      ),
    )

    // The review rows render `ingredient.name` and the alternatives' names, and
    // the matcher returns the English ones (HON-913).
    const ingredients = await translateMatchResults(result.ingredients, parserLocale)

    return NextResponse.json({
      success: true,
      recipe: {
        name: result.name,
        description: result.description,
        preparationNotes: result.preparationNotes,
        sourceUrl: result.sourceUrl,
        timeMinutes: result.timeMinutes,
        servings: result.servings,
        mealTypes: result.mealTypes,
        kidFriendly: result.kidFriendly,
        ingredients,
        allMatched: result.allMatched,
      },
      confidenceTier: result.confidenceTier,
      confidenceWarning: result.confidenceWarning,
    })
  } catch (error) {
    if (error instanceof RecipeParseError) {
      // An unreachable or overloaded provider is ours to report and a retry may
      // well succeed, so it answers 503 rather than the 400 that tells a client
      // its input was bad. 503, not 502, for every provider failure: the client
      // does the same thing either way, and the reported cause keeps the
      // upstream status for diagnosis. Only this code is reported — ordinary
      // validation failures below stay out of Sentry (HON-723).
      if (error.code === 'provider_unavailable') {
        captureApiError(error.cause ?? error, {
          route: '/api/recipes/parse',
          userId: session.user.id,
          feature: 'recipe_parse',
        })
        return NextResponse.json(errorBody(error.message, error.code), {
          status: 503,
          headers: { 'Retry-After': String(PROVIDER_RETRY_AFTER_SECONDS) },
        })
      }
      // The code, not the prose, picks the status — the message is free text
      // that a copy edit could silently break (HON-700).
      const status = error.code === 'robots_disallowed' ? 403 : 400
      return NextResponse.json(errorBody(error.message, error.code), { status })
    }

    captureApiError(error, {
      route: '/api/recipes/parse',
      userId: session.user.id,
      feature: 'recipe_parse',
    })

    // Only the AI call can surface a `TimeoutError` here: `fetchRecipeFromUrl`
    // converts its own 15s abort into a `RecipeParseError`, handled above.
    // Reported before it is classified, as the reference route does: a timeout
    // is user-facing but it also means the budget above is mis-sized, which is
    // exactly what should show up in Sentry.
    if (isAiBudgetTimeout(error)) {
      return NextResponse.json(
        errorBody('Reading that recipe took too long. Please try again.', 'parse_timeout'),
        { status: 504 },
      )
    }

    return NextResponse.json(
      errorBody('Failed to parse the recipe. Please try again.', 'parse_failed'),
      { status: 500 },
    )
  }
}

export const POST = withRequestId(handlePOST)

/**
 * Platform execution ceiling for this route, in seconds.
 *
 * Stated explicitly because the AI budgets above are only meaningful if the platform
 * lets the function run that long — otherwise the request is killed first and
 * the friendly 504 above never runs. 60 is the value every Vercel plan allows,
 * so this cannot fail to deploy (HON-693).
 *
 * `RecipeImportClient` aborts only on an explicit user cancel or unmount, so
 * it does not pre-empt this ceiling.
 */
export const maxDuration = 60
