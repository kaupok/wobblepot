import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { serverEnv } from '@/lib/env'
import { getHouseholdMembership } from '@/lib/household'
import {
  parseAndMatchRecipe,
  fetchRecipeFromUrl,
  RecipeParseError,
  ROBOTS_DISALLOWED_MESSAGE,
} from '@/lib/ai/parse-recipe'
import { DEFAULT_LOCALE } from '@/lib/i18n/locales'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'
import {
  AiCostCapExceededError,
  assertUnderCap,
  recordAiUsage,
  respondCapExceeded,
} from '@/lib/ai/usage'

/**
 * HON-502 gate: Estonian recipe parsing is held behind an opt-in env flag
 * until HON-506 seeds Estonian ingredient translations. Without that data,
 * Estonian input creates household-scoped duplicate ingredient rows that
 * later require admin cleanup via HON-514. Flip `FEATURE_RECIPE_PARSER_ET`
 * to `"1"` (or `"true"`) as part of HON-506's merge.
 */
function resolveParserLocale(householdLocale: string): string {
  if (householdLocale === DEFAULT_LOCALE) return householdLocale
  const flag = serverEnv.FEATURE_RECIPE_PARSER_ET
  if (flag === '1' || flag === 'true') return householdLocale
  return DEFAULT_LOCALE
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

export async function POST(request: Request) {
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

    console.error('Failed to parse recipe:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to parse the recipe. Please try again.',
      },
      { status: 500 },
    )
  }
}
