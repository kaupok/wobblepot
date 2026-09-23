import { createAnthropic } from '@ai-sdk/anthropic'
import { APICallError, generateObject, NoObjectGeneratedError, RetryError } from 'ai'
import { serverEnv } from '@/lib/env'
import { RECIPE_MODEL } from './models'
import { toAiUsageStats, withUsageOnFailure, type AiUsageStats } from './usage'
import type { MealType } from '@/generated/prisma/enums'
import { logAiSample } from './sampling'
import { RecipeParseError } from './recipe-errors'
import { RecipeExtractionSchema } from './recipe-schema'
import type { RecipeExtraction } from './recipe-schema'
import {
  evaluateRecipeConfidence,
  type ConfidenceResult,
  type ConfidenceTier,
} from './recipe-confidence'
import { buildRecipeExtractionPrompt } from './recipe-prompt'
import { isAiBudgetTimeout } from './timeout'
import { matchIngredients, type IngredientMatchResult } from './match-ingredients'

/**
 * Result of parsing recipe text, including confidence evaluation.
 */
export interface ParseRecipeResult {
  extraction: RecipeExtraction
  confidence: ConfidenceResult
}

/**
 * Parse recipe text using AI to extract structured data.
 * Throws RecipeParseError if the text doesn't contain enough information or confidence is low.
 *
 * `abortSignal` is the wall-clock budget for the AI call, owned by
 * `/api/recipes/parse`. Undefined leaves the call unbounded, which is the
 * pre-HON-694 behaviour.
 */
export async function parseRecipeText(
  recipeText: string,
  locale?: string,
  onAiUsage?: (usage: AiUsageStats) => void,
  abortSignal?: AbortSignal,
): Promise<ParseRecipeResult> {
  const trimmedText = recipeText.trim()

  // Minimum sanity check
  if (trimmedText.length < 20) {
    throw new RecipeParseError(
      'The text is too short to be a recipe. Please paste a complete recipe with ingredients.',
      'text_too_short',
    )
  }

  const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })
  const prompt = buildRecipeExtractionPrompt(trimmedText, locale)

  try {
    const result = await withUsageOnFailure(RECIPE_MODEL, onAiUsage, () =>
      generateObject({
        model: anthropic(RECIPE_MODEL),
        schema: RecipeExtractionSchema,
        prompt,
        // Wall-clock budget owned by `/api/recipes/parse` — shared by this
        // attempt and every retry, not a per-attempt timeout.
        abortSignal,
      }),
    )

    const { object } = result

    onAiUsage?.(toAiUsageStats(RECIPE_MODEL, result.usage))

    await logAiSample({
      callSite: 'parse-recipe',
      locale,
      input: {
        textPreview: trimmedText.slice(0, 1000),
        textLength: trimmedText.length,
      },
      output: object,
    })

    // Validate we got meaningful data
    if (!object.name || object.ingredients.length === 0) {
      throw new RecipeParseError(
        "Couldn't extract a recipe from this text. Please make sure it includes a recipe name and list of ingredients.",
        'no_recipe_found',
      )
    }

    // Check for placeholder/invalid ingredient names
    const invalidIngredients = object.ingredients.filter((ing) => {
      const name = ing.name.toLowerCase().trim()
      return (
        name.includes('<unknown>') ||
        name.includes('unknown') ||
        name === '' ||
        name === 'ingredient' ||
        name === 'item'
      )
    })

    if (invalidIngredients.length > 0 || object.ingredients.length === invalidIngredients.length) {
      throw new RecipeParseError(
        "Couldn't identify specific ingredients from this text. Please paste a recipe with a clear list of ingredients.",
        'no_ingredients_found',
      )
    }

    // Evaluate confidence
    const confidence = evaluateRecipeConfidence(object)
    if (confidence.tier === 'low') {
      throw new RecipeParseError(
        confidence.message ??
          "This doesn't appear to contain a recipe. Try pasting the recipe text directly.",
        'low_confidence',
      )
    }

    return { extraction: object, confidence }
  } catch (error) {
    if (error instanceof RecipeParseError) {
      throw error
    }
    // The route's wall-clock budget firing is not a parse failure, and must
    // reach `/api/recipes/parse` intact: wrapping it here would make the 400
    // below match first, so the mapped 504 would be unreachable and
    // `captureApiError` would never report the mis-sized budget (HON-694).
    if (isAiBudgetTimeout(error)) {
      throw error
    }
    // The provider could not be reached or is overloaded: a 5xx, a 429, or a
    // connection failure (`handleFetchError` in the SDK turns ECONNRESET,
    // "fetch failed" and friends into an `APICallError`). `RetryError` is the
    // same thing after `maxRetries` ran out. The user's input was fine, so this
    // must not reach the route as a 400 — and it must reach Sentry (HON-723).
    //
    // Only the transient ones, which the SDK flags with `isRetryable`. A
    // non-retryable 4xx — a prompt past the context window, a revoked API key
    // — fails the same way on every retry, so a 503 + `Retry-After` would be a
    // false promise; it falls through to the reported 500 below.
    if (isTransientProviderError(error)) {
      throw new RecipeParseError(
        'The recipe service is temporarily unavailable. Please try again in a moment.',
        'provider_unavailable',
        { cause: error },
      )
    }
    // The model answered, but not with anything the schema accepts: that is
    // "we could not read this recipe", which is what `parse_failed` means.
    if (NoObjectGeneratedError.isInstance(error)) {
      throw new RecipeParseError(
        'Failed to parse the recipe. Please try again or use the manual form.',
        'parse_failed',
      )
    }
    // Anything else is a bug on our side. Let it reach the route's generic 500,
    // which reports it, instead of disguising it as a user-input 400.
    throw error
  }
}

/**
 * A provider failure that a later retry may well get past. A `RetryError` is
 * judged by its `lastError`, not its `reason`: the SDK checks the retry count
 * before retryability, so 529, 529, 401 ends as `maxRetriesExceeded` even
 * though the call finally failed on something no retry fixes.
 */
function isTransientProviderError(error: unknown): boolean {
  const cause = RetryError.isInstance(error) ? error.lastError : error
  return APICallError.isInstance(cause) && cause.isRetryable
}

/**
 * Result of the full recipe parsing and matching process.
 */
export interface ParsedRecipe {
  name: string
  description: string | null
  preparationNotes: string | null
  sourceUrl: string | null
  timeMinutes: number | null
  servings: number
  mealTypes: MealType[]
  kidFriendly: boolean
  ingredients: IngredientMatchResult[]
  allMatched: boolean
  confidenceTier: ConfidenceTier
  confidenceWarning?: string
}

/**
 * Parse recipe text and match ingredients against the database.
 * This is the main entry point for the recipe import feature.
 *
 * @param recipeText - The recipe text to parse
 * @param sourceUrl - Optional source URL for URL imports (stored as dedicated field)
 * @param onAiUsage - Callback for tracking AI usage stats
 * @param matchOptions - Household + locale context for ingredient matching
 */
export async function parseAndMatchRecipe(
  recipeText: string,
  sourceUrl?: string,
  onAiUsage?: (usage: AiUsageStats) => void,
  matchOptions: { householdId?: string | null; locale?: string } = {},
  // Kept out of `matchOptions`: that object is forwarded to `matchIngredients`,
  // which is deterministic, so an AI-only budget on it would misstate what it
  // controls.
  abortSignal?: AbortSignal,
): Promise<ParsedRecipe> {
  // Step 1: Extract structured data from text (low confidence throws). Thread
  // the household locale so the parser prompt includes the output-language
  // instruction; matcher-side locale threading is handled via `matchOptions`.
  const { extraction, confidence } = await parseRecipeText(
    recipeText,
    matchOptions.locale,
    onAiUsage,
    abortSignal,
  )

  // Step 2: Match ingredients against database (pass servings for validation)
  const ingredientResults = await matchIngredients(
    extraction.ingredients,
    extraction.servings,
    matchOptions,
  )

  // Step 3: Check if all ingredients matched
  const allMatched = ingredientResults.every((r) => r.type === 'matched')

  return {
    name: extraction.name,
    description: extraction.description,
    preparationNotes: extraction.preparationNotes,
    sourceUrl: sourceUrl ?? null,
    timeMinutes: extraction.timeMinutes,
    servings: extraction.servings,
    mealTypes: extraction.mealTypes as MealType[],
    kidFriendly: extraction.kidFriendly,
    ingredients: ingredientResults,
    allMatched,
    confidenceTier: confidence.tier,
    confidenceWarning: confidence.message,
  }
}
