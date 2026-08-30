import type { RecipeExtraction } from './recipe-schema'

/**
 * Confidence tier for recipe extraction quality.
 */
export type ConfidenceTier = 'high' | 'medium' | 'low'

export interface ConfidenceResult {
  tier: ConfidenceTier
  message?: string
}

/**
 * Pattern guard: invalid recipe name patterns that indicate fabrication.
 */
const INVALID_NAME_PATTERNS = [
  /^error/i,
  /not found/i,
  /\bn\/a\b/i,
  /^untitled$/i,
  /^unknown$/i,
  /^none$/i,
  /^n\/a$/i,
]

/**
 * Pattern guard: invalid ingredient name patterns.
 */
const INVALID_INGREDIENT_PATTERNS = [/placeholder/i, /\berror\b/i, /\bexample\b/i, /\btest\b/i]

/**
 * Evaluate recipe extraction confidence using three layers:
 * 1. Pattern guards (force rejection on known fabrication signals)
 * 2. Post-AI heuristics (vague ratio, identical quantities, low count)
 * 3. AI confidence score (adjusted by heuristics)
 */
export function evaluateRecipeConfidence(extraction: RecipeExtraction): ConfidenceResult {
  // Layer 1: Pattern guards — always reject
  const nameLower = extraction.name.toLowerCase().trim()
  for (const pattern of INVALID_NAME_PATTERNS) {
    if (pattern.test(nameLower)) {
      return {
        tier: 'low',
        message:
          "This doesn't appear to contain a recipe. Try pasting the recipe text directly, or check that the page has a specific recipe with ingredients.",
      }
    }
  }

  const suspiciousIngredients = extraction.ingredients.filter((ing) => {
    const name = ing.name.toLowerCase().trim()
    return INVALID_INGREDIENT_PATTERNS.some((pattern) => pattern.test(name))
  })
  if (suspiciousIngredients.length > 0) {
    return {
      tier: 'low',
      message:
        "This doesn't appear to contain a recipe. Try pasting the recipe text directly, or check that the page has a specific recipe with ingredients.",
    }
  }

  // Layer 2: Post-AI heuristics
  let adjustedScore = extraction.recipeConfidence

  // Check vague ingredient ratio
  const vagueCount = extraction.ingredients.filter((ing) => ing.isVague).length
  const totalCount = extraction.ingredients.length
  if (totalCount > 0 && vagueCount / totalCount > 0.5) {
    adjustedScore -= 20
  }

  // Check for very few ingredients with no real quantities
  const ingredientsWithQuantities = extraction.ingredients.filter(
    (ing) => !ing.isVague && ing.quantity !== null && ing.quantity > 0,
  )
  if (totalCount < 3 && ingredientsWithQuantities.length === 0) {
    adjustedScore -= 30
  }

  // Check for identical quantities (hallucination pattern)
  if (totalCount >= 3) {
    const quantities = extraction.ingredients
      .filter((ing) => ing.quantity !== null)
      .map((ing) => ing.quantity)
    if (quantities.length >= 3) {
      const allSame = quantities.every((q) => q === quantities[0])
      if (allSame) {
        adjustedScore -= 25
      }
    }
  }

  // Layer 3: Map adjusted score to tier
  if (adjustedScore > 60) {
    return { tier: 'high' }
  }

  if (adjustedScore >= 30) {
    return {
      tier: 'medium',
      message:
        "We're not confident this is a complete recipe. The results may be incomplete or inaccurate.",
    }
  }

  return {
    tier: 'low',
    message:
      "This doesn't appear to contain a recipe. Try pasting the recipe text directly, or check that the page has a specific recipe with ingredients.",
  }
}

/**
 * Minimum similarity score for a match to be considered "confident".
 * Below this threshold, we show disambiguation UI to the user.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.6

/**
 * Floor threshold for showing "verify match" suggestions.
 * Matches below this score are too unreliable to suggest — they're treated
 * as fully unmatched rather than shown as low-confidence suggestions.
 *
 * Examples of false positives this threshold filters out:
 * - "fajita seasoning" → "italian seasoning"
 * - "red chili pepper" → "red bell pepper" (similarity ~0.53, semantically wrong)
 *
 * Raised from 0.5 to 0.55 to prevent similar-sounding but semantically different
 * ingredients from being suggested as verify-matches.
 */
export const VERY_LOW_CONFIDENCE_THRESHOLD = 0.55
