import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { parseAndMatchRecipe } from '@/lib/ai/parse-recipe'
import { fetchRecipeFromUrl, ROBOTS_DISALLOWED_MESSAGE } from '@/lib/ai/recipe-fetch'
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

const parseRecipeSchema = z.object({
  text: z.string().min(1, 'Recipe text is required'),
})

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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const rateLimitResult = await checkRateLimit(membership.household.id, 'recipe-parse')
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: 'Rate limit exceeded',
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
        success: false,
        error: 'Recipe import is temporarily disabled',
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
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = parseRecipeSchema.safeParse(body)

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors
    return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
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
      const status = error.message === ROBOTS_DISALLOWED_MESSAGE ? 403 : 400
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status },
      )
    }

    captureApiError(error, {
      route: '/api/recipes/parse',
      userId: session.user.id,
      feature: 'recipe_parse',
    })
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to parse the recipe. Please try again.',
      },
      { status: 500 },
    )
  }
}

export const POST = withRequestId(handlePOST)
