import type { IngredientCategory, Unit } from '@/generated/prisma/enums'
import { getVagueDefault, checkGuardrail, type VagueQuantityResult } from '@/lib/vague-quantities'
import { applyIngredientAlias } from '@/lib/ingredient-aliases'
import { normalizeIngredientName, extractLastWord } from '@/lib/normalize-ingredient'
import type { ExtractedIngredient } from './recipe-schema'
import { LOW_CONFIDENCE_THRESHOLD, VERY_LOW_CONFIDENCE_THRESHOLD } from './recipe-confidence'
import { convertQuantity, isReasonableQuantity, DEFAULT_GRAMS_PER_PIECE } from './recipe-quantities'
import { fuzzySearchIngredient } from './fuzzy-ingredient-match'

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
