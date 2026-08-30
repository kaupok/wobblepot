import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { serverEnv } from '@/lib/env'
import { RECIPE_MODEL } from './models'
import type { AiUsageStats } from './usage'
import type { IngredientCategory, MealType, Unit } from '@/generated/prisma/enums'
import { getVagueDefault, checkGuardrail, type VagueQuantityResult } from '@/lib/vague-quantities'
import { applyIngredientAlias } from '@/lib/ingredient-aliases'
import { normalizeIngredientName, extractLastWord } from '@/lib/normalize-ingredient'
import { logAiSample } from './sampling'
import { RecipeParseError } from './recipe-errors'
import { RecipeExtractionSchema } from './recipe-schema'
import type { ExtractedIngredient, RecipeExtraction } from './recipe-schema'
import {
  evaluateRecipeConfidence,
  LOW_CONFIDENCE_THRESHOLD,
  VERY_LOW_CONFIDENCE_THRESHOLD,
  type ConfidenceResult,
  type ConfidenceTier,
} from './recipe-confidence'
import { buildRecipeExtractionPrompt } from './recipe-prompt'
import { convertQuantity, isReasonableQuantity, DEFAULT_GRAMS_PER_PIECE } from './recipe-quantities'
import { fuzzySearchIngredient } from './fuzzy-ingredient-match'

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
 * Result of matching an ingredient against the database.
 */
export interface MatchedIngredient {
  type: 'matched'
  extractedName: string
  extractedQuantity: number
  extractedUnit: string
  originalText: string
  ingredient: {
    id: string
    name: string
    category: IngredientCategory
    subcategory: string | null
    defaultUnit: Unit
    gramsPerPiece: number | null
    calories: number
    protein: number
    carbs: number
    fat: number
  }
  /** Quantity converted to the ingredient's default unit */
  convertedQuantity: number
  /** Warning if quantity seems unusually high */
  quantityWarning?: string
  /** True if quantity was vague (e.g., "to taste") */
  isVague: boolean
  /** The original vague phrase if isVague is true */
  originalPhrase?: string
  /** Similarity score from trigram matching (0-1) */
  similarityScore: number
  /** True if match confidence is low and needs user disambiguation */
  lowConfidence: boolean
  /** Alternative ingredient candidates for disambiguation (only when lowConfidence is true) */
  alternatives?: Array<{
    id: string
    name: string
    category: IngredientCategory
    defaultUnit: Unit
    similarity: number
  }>
}

export interface UnmatchedIngredient {
  type: 'unmatched'
  extractedName: string
  extractedQuantity: number
  extractedUnit: string
  originalText: string
  /** True if quantity was vague (e.g., "to taste") */
  isVague: boolean
  /** The original vague phrase if isVague is true */
  originalPhrase?: string
}

export type IngredientMatchResult = MatchedIngredient | UnmatchedIngredient

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
 * Match extracted ingredients against the database using fuzzy search.
 * Tries direct match first, then falls back to alias expansion if needed.
 *
 * @param extractedIngredients - The ingredients extracted by AI
 * @param servings - Number of servings for quantity validation
 * @param options.householdId - Used to also search the household's own ingredient pool
 *                              (in addition to the global seeded pool).
 * @param options.locale - Used to also search `ingredient_translation` rows for the
 *                         locale, so a query like "sibul" can find the English `onion`.
 */
export async function matchIngredients(
  extractedIngredients: ExtractedIngredient[],
  servings: number,
  options: { householdId?: string | null; locale?: string } = {},
): Promise<IngredientMatchResult[]> {
  const results: IngredientMatchResult[] = []
  const searchOptions = { householdId: options.householdId, locale: options.locale }

  for (const extracted of extractedIngredients) {
    const directName = extracted.name.toLowerCase().trim()

    // Build candidate search names (deduplicated, in priority order)
    const candidateNames = new Set<string>()
    candidateNames.add(directName)

    // Alias expansion
    const expandedName = applyIngredientAlias(extracted.name)
    const aliasName = expandedName.toLowerCase().trim()
    candidateNames.add(aliasName)

    // Normalized name (strip modifiers + singularize)
    const normalizedName = normalizeIngredientName(directName)
    candidateNames.add(normalizedName)

    // Alias of normalized name
    const normalizedAliasName = applyIngredientAlias(normalizedName).toLowerCase().trim()
    candidateNames.add(normalizedAliasName)

    // Phase 1: Search semantic candidates (direct, alias, normalized, alias-normalized)
    let matches: Awaited<ReturnType<typeof fuzzySearchIngredient>> = []
    for (const candidate of candidateNames) {
      const candidateMatches = await fuzzySearchIngredient(candidate, searchOptions)
      if (candidateMatches[0] && candidateMatches[0].similarity > (matches[0]?.similarity ?? 0)) {
        matches = candidateMatches
      }
    }

    // Phase 2: Last-word fallback — ONLY if no semantic match found above threshold
    // This prevents "trout fillet" → "fillet" → "cod fillet" from overriding
    // the direct search result when a reasonable match already exists.
    // Uses VERY_LOW_CONFIDENCE_THRESHOLD because matches below it would be treated
    // as unmatched anyway — so the fallback can only improve the outcome.
    if (!matches[0] || matches[0].similarity < VERY_LOW_CONFIDENCE_THRESHOLD) {
      const lastWord = extractLastWord(directName)
      if (lastWord) {
        const fallbackMatches = await fuzzySearchIngredient(lastWord, searchOptions)
        if (fallbackMatches[0] && fallbackMatches[0].similarity > (matches[0]?.similarity ?? 0)) {
          // Safety: only accept fallback if the last word appears as a complete word
          // in the matched name. Prevents "sausage" → "sage" (substring trigram match)
          // while allowing "sauce" → "soy sauce" and "bread" → "bread".
          const matchedWords = new Set(fallbackMatches[0].name.toLowerCase().split(/\s+/))
          if (matchedWords.has(lastWord)) {
            matches = fallbackMatches
          }
        }
      }
    }

    if (matches.length > 0 && matches[0]) {
      const match = matches[0]
      const similarityScore = match.similarity

      // Very low similarity — treat as unmatched to avoid misleading suggestions
      if (similarityScore < VERY_LOW_CONFIDENCE_THRESHOLD) {
        results.push({
          type: 'unmatched',
          extractedName: extracted.name,
          extractedQuantity: extracted.quantity ?? 0,
          extractedUnit: extracted.unit ?? 'g',
          originalText: extracted.originalText,
          isVague: extracted.isVague,
          originalPhrase: extracted.vaguePhrase ?? undefined,
        })
        continue
      }

      let lowConfidence = similarityScore < LOW_CONFIDENCE_THRESHOLD

      // Safety check: if primary nouns differ between extracted and matched name,
      // force low-confidence regardless of trigram score.
      // e.g., "trout fillet" → "cod fillet": trout ≠ cod → flag for review
      if (!lowConfidence && directName.includes(' ')) {
        const COMMON_SUFFIXES = new Set([
          'fillet',
          'breast',
          'thigh',
          'leg',
          'wing',
          'steak',
          'chop',
          'loin',
          'rib',
        ])
        const extractedWords = new Set(directName.split(/\s+/))
        const matchedWords = new Set(match.name.toLowerCase().split(/\s+/))

        const extractedUnique = [...extractedWords].filter(
          (w) => !matchedWords.has(w) && !COMMON_SUFFIXES.has(w),
        )
        const matchedUnique = [...matchedWords].filter(
          (w) => !extractedWords.has(w) && !COMMON_SUFFIXES.has(w),
        )

        if (extractedUnique.length > 0 && matchedUnique.length > 0) {
          lowConfidence = true
        }
      }

      // Get alternatives for disambiguation if low confidence
      const alternatives = lowConfidence
        ? matches.slice(0, 3).map((m) => ({
            id: m.id,
            name: m.name,
            category: m.category,
            defaultUnit: m.defaultUnit,
            similarity: m.similarity,
          }))
        : undefined

      // Handle vague quantities
      let convertedQuantity: number
      let isVague = extracted.isVague
      let originalPhrase = extracted.vaguePhrase ?? undefined
      let quantityWarning: string | undefined
      let vagueResult: VagueQuantityResult | null = null

      if (isVague && originalPhrase) {
        // Apply rule-based default for vague quantity
        vagueResult = getVagueDefault(
          match.category,
          match.subcategory,
          originalPhrase,
          extracted.isDried ?? undefined,
        )

        if (vagueResult) {
          // Quantity from vagueResult is per-serving, but we store total quantity for recipe
          // The convertedQuantity here represents total for the recipe (all servings)
          convertedQuantity = vagueResult.quantity * servings
        } else {
          // Fallback: use 10g per serving as default
          convertedQuantity = 10 * servings
        }
      } else if (extracted.quantity !== null && extracted.unit !== null) {
        // Normal quantity conversion
        convertedQuantity = convertQuantity(extracted.quantity, extracted.unit, match)

        // Calculate per-serving for validation
        const quantityPerServing = convertedQuantity / servings

        // Check guardrails for non-vague quantities
        quantityWarning = checkGuardrail(quantityPerServing, match.category, match.subcategory)

        // Also check general reasonableness
        if (!quantityWarning) {
          let totalGrams = convertedQuantity
          if (match.defaultUnit === 'piece') {
            totalGrams = convertedQuantity * (match.gramsPerPiece ?? DEFAULT_GRAMS_PER_PIECE)
          }

          if (!isReasonableQuantity(totalGrams, servings)) {
            const gramsPerServing = Math.round(totalGrams / servings)
            quantityWarning = `Unusually high: ${gramsPerServing}g per serving. Please verify this amount.`
          }
        }
      } else {
        // Shouldn't happen, but fallback
        convertedQuantity = 10 * servings
        isVague = true
        originalPhrase = 'some'
      }

      results.push({
        type: 'matched',
        extractedName: extracted.name,
        extractedQuantity: extracted.quantity ?? 0,
        extractedUnit: extracted.unit ?? 'g',
        originalText: extracted.originalText,
        ingredient: {
          id: match.id,
          name: match.name,
          category: match.category,
          subcategory: match.subcategory,
          defaultUnit: match.defaultUnit,
          gramsPerPiece: match.gramsPerPiece,
          calories: match.calories,
          protein: match.protein,
          carbs: match.carbs,
          fat: match.fat,
        },
        convertedQuantity,
        quantityWarning,
        isVague,
        originalPhrase,
        similarityScore,
        lowConfidence,
        alternatives,
      })
    } else {
      results.push({
        type: 'unmatched',
        extractedName: extracted.name,
        extractedQuantity: extracted.quantity ?? 0,
        extractedUnit: extracted.unit ?? 'g',
        originalText: extracted.originalText,
        isVague: extracted.isVague,
        originalPhrase: extracted.vaguePhrase ?? undefined,
      })
    }
  }

  return mergeDuplicateIngredients(results, servings)
}

/**
 * Merge duplicate matched ingredients (same ingredientId) into single rows.
 * Quantities are summed. If either row is vague, the merged row is vague with no quantity.
 * Unmatched ingredients pass through unchanged.
 * Re-runs guardrail checks on summed quantities since individually-valid amounts may exceed
 * thresholds when combined.
 */
export function mergeDuplicateIngredients(
  results: IngredientMatchResult[],
  servings: number,
): IngredientMatchResult[] {
  const merged: IngredientMatchResult[] = []
  const matchedById = new Map<string, MatchedIngredient>()

  for (const result of results) {
    if (result.type !== 'matched') {
      merged.push(result)
      continue
    }

    const id = result.ingredient.id
    const existing = matchedById.get(id)

    if (!existing) {
      matchedById.set(id, result)
      continue
    }

    // Merge: if either is vague, result is vague with zero quantity
    if (existing.isVague || result.isVague) {
      matchedById.set(id, {
        ...existing,
        convertedQuantity: 0,
        isVague: true,
        originalPhrase: existing.originalPhrase ?? result.originalPhrase,
        originalText: `${existing.originalText} + ${result.originalText}`,
        quantityWarning: undefined,
      })
    } else {
      // Both have quantities — sum them, re-run guardrails on combined total
      const summedQuantity = existing.convertedQuantity + result.convertedQuantity
      const { category, subcategory, defaultUnit, gramsPerPiece } = existing.ingredient
      const quantityPerServing = summedQuantity / servings

      let quantityWarning = checkGuardrail(quantityPerServing, category, subcategory)
      if (!quantityWarning) {
        let totalGrams = summedQuantity
        if (defaultUnit === 'piece') {
          totalGrams = summedQuantity * (gramsPerPiece ?? DEFAULT_GRAMS_PER_PIECE)
        }
        if (!isReasonableQuantity(totalGrams, servings)) {
          const gramsPerServing = Math.round(totalGrams / servings)
          quantityWarning = `Unusually high: ${gramsPerServing}g per serving. Please verify this amount.`
        }
      }

      matchedById.set(id, {
        ...existing,
        convertedQuantity: summedQuantity,
        originalText: `${existing.originalText} + ${result.originalText}`,
        quantityWarning,
      })
    }
  }

  // Build final array preserving original order.
  // Walk the original results: emit each unmatched as-is,
  // emit each matched ingredient at its first occurrence (merged).
  const unmatchedResults = merged
  const finalResults: IngredientMatchResult[] = []
  let unmatchedIndex = 0
  const emittedIds = new Set<string>()

  for (const result of results) {
    if (result.type !== 'matched') {
      finalResults.push(unmatchedResults[unmatchedIndex]!)
      unmatchedIndex++
    } else {
      const id = result.ingredient.id
      if (!emittedIds.has(id)) {
        emittedIds.add(id)
        finalResults.push(matchedById.get(id)!)
      }
    }
  }

  return finalResults
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
