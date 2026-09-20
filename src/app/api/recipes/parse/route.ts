import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { parseAndMatchRecipe } from '@/lib/ai/parse-recipe'
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

/**
 * Resolve the locale the recipe parser runs in. The `FEATURE_RECIPE_PARSER_ET`
 * gate (HON-502) held Estonian parsing back until HON-506 seeded Estonian
 * ingredient translations; with that data landed the gate is retired and the
 * household locale threads straight through. Every `KNOWN_LOCALES` value now
 * has translation coverage, so the matcher resolves Estonian ingredient names
 * directly instead of creating household-scoped duplicates.
 */
function resolveParserLocale(householdLocale: string): string {
  return householdLocale
}

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
 * Wall-clock budget for all AI time in this request, in milliseconds — one
 * value per input path, because only one of them pays a fetch first.
 *
 * Each is shared by the initial attempt and every `maxRetries` retry rather
 * than being a per-attempt timeout, which makes it the real bound on retries —
 * a fast failure (429, 5xx) costs well under a second and still retries
 * freely; a slow generation does not. Both signals are created *after* any
 * fetch, so network time is spent from the ceiling below, never from the model
 * budget.
 *
 * Sized against the figures recorded on Sonnet 5 during HON-693: preparation
 * tips 15-21s, quantity review 25-32s, both on deliberately hard inputs.
 * Recipe extraction is the quantity-review shape, so it wants the full 45s the
 * tips route uses — and on pasted text it gets it, leaving 15s under
 * `maxDuration` for ingredient matching and the response.
 *
 * A URL import cannot afford that. `fetchRecipeFromUrl` runs two sequential
 * network calls before returning any text: `checkRobotsAllowed`, up to 5s on a
 * cache miss (`ROBOTS_FETCH_TIMEOUT_MS`, `src/lib/robots.ts`), and then the
 * page itself, up to 15s (`AbortSignal.timeout(15000)`, `recipe-fetch.ts`).
 * Worst case that is 20s gone before the model starts, so the budget drops to
 * 30s: 20 + 30 = 50s, the same 10s of slack the other two routes keep. A
 * single 45s constant would put the worst case at 65s — past the ceiling, so
 * the platform would kill the function and the 504 below would never run,
 * which is the whole failure this issue exists to close.
 */
const AI_BUDGET_MS = 45_000
const AI_BUDGET_AFTER_URL_FETCH_MS = 30_000

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
  // outages — see docs/FEATURE_FLAGS.md.
  const recipeImportEnabled = await getServerFlag('recipe_import_enabled', session.user.id)
  if (!recipeImportEnabled) {
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

    const parserLocale = resolveParserLocale(membership.household.locale)

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
      AbortSignal.timeout(sourceUrl ? AI_BUDGET_AFTER_URL_FETCH_MS : AI_BUDGET_MS),
    )

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
        ingredients: result.ingredients,
        allMatched: result.allMatched,
      },
      confidenceTier: result.confidenceTier,
      confidenceWarning: result.confidenceWarning,
    })
  } catch (error) {
    if (error instanceof RecipeParseError) {
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
