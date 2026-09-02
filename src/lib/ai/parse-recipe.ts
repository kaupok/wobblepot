import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { serverEnv } from '@/lib/env'
import { RECIPE_MODEL } from './models'
import type { AiUsageStats } from './usage'
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
 */
export async function parseRecipeText(
  recipeText: string,
  locale?: string,
  onAiUsage?: (usage: AiUsageStats) => void,
): Promise<ParseRecipeResult> {
  const trimmedText = recipeText.trim()

  // Minimum sanity check
  if (trimmedText.length < 20) {
    throw new RecipeParseError(
      'The text is too short to be a recipe. Please paste a complete recipe with ingredients.',
    )
  }

  const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })
  const prompt = buildRecipeExtractionPrompt(trimmedText, locale)

  try {
    const result = await generateObject({
      model: anthropic(RECIPE_MODEL),
      schema: RecipeExtractionSchema,
      prompt,
    })

    const { object } = result

    onAiUsage?.({
      model: RECIPE_MODEL,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    })

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
      )
    }

    // Evaluate confidence
    const confidence = evaluateRecipeConfidence(object)
    if (confidence.tier === 'low') {
      throw new RecipeParseError(
        confidence.message ??
          "This doesn't appear to contain a recipe. Try pasting the recipe text directly.",
      )
    }

    return { extraction: object, confidence }
  } catch (error) {
    if (error instanceof RecipeParseError) {
      throw error
    }
    // AI generation error
    throw new RecipeParseError(
      'Failed to parse the recipe. Please try again or use the manual form.',
    )
  }
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
): Promise<ParsedRecipe> {
  // Step 1: Extract structured data from text (low confidence throws). Thread
  // the household locale so the parser prompt includes the output-language
  // instruction; matcher-side locale threading is handled via `matchOptions`.
  const { extraction, confidence } = await parseRecipeText(
    recipeText,
    matchOptions.locale,
    onAiUsage,
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
