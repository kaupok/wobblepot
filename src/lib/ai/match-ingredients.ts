import type { IngredientCategory, ProteinType, Unit } from '@/generated/prisma/enums'
import { applyIngredientAlias, findSynonym } from '@/lib/ingredient-aliases'
import { extractLastWord, normalizeIngredientName, pluralize } from '@/lib/normalize-ingredient'
import {
  checkGuardrail,
  getVagueDefault,
  MIXED_VAGUE_PHRASE,
  type VagueQuantityResult,
} from '@/lib/vague-quantities'

import { applyFormGuard, foodNameOf, isOtherCutFillet } from './form-modifier-guard'
import { fuzzySearchIngredient } from './fuzzy-ingredient-match'
import { isBareLastWord, primaryNounsDiffer } from './match-word-checks'
import { LOW_CONFIDENCE_THRESHOLD, VERY_LOW_CONFIDENCE_THRESHOLD } from './recipe-confidence'
import { convertQuantity, DEFAULT_GRAMS_PER_PIECE, isReasonableQuantity } from './recipe-quantities'
import type { ExtractedIngredient } from './recipe-schema'

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
    measuredByVolume: boolean
    calories: number
    protein: number
    carbs: number
    fat: number
    proteinType: ProteinType | null
  }
  /** Quantity converted to the ingredient's default unit */
  convertedQuantity: number
  /** Warning if quantity seems unusually high */
  quantityWarning?: string
  /** True if quantity was vague (e.g., "to taste") */
  isVague: boolean
  /** The original vague phrase if isVague is true */
  originalPhrase?: string
  /**
   * The name the match was made on: the translation's name when the match came
   * through `ingredient_translation`, otherwise `ingredient.name`.
   */
  matchedName?: string
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
    measuredByVolume: boolean
    /** A picked alternative feeds the form's "Main protein" choice (HON-1386). */
    gramsPerPiece: number | null
    protein: number
    proteinType: ProteinType | null
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
    const foodName = foodNameOf(extracted.name)
    const directName = foodName.toLowerCase().trim()

    // Build candidate search names (deduplicated, in priority order)
    const candidateNames = new Set<string>()
    candidateNames.add(directName)

    // Alias expansion
    const expandedName = applyIngredientAlias(foodName)
    const aliasName = expandedName.toLowerCase().trim()
    candidateNames.add(aliasName)

    // Normalized name (strip modifiers + singularize)
    const normalizedName = normalizeIngredientName(directName)
    candidateNames.add(normalizedName)

    // Alias of normalized name
    const normalizedAliasName = applyIngredientAlias(normalizedName).toLowerCase().trim()
    candidateNames.add(normalizedAliasName)

    // The normalized name with its last word made plural, so a singular recipe word
    // finds a plural catalogue or household row: "bay leaf" → "bay leaves" (HON-1267).
    // It is searched in the normalized name's own query, so it costs no extra query.
    const normalizedWords = normalizedName.split(' ')
    const lastNormalizedWord = normalizedWords.pop()
    const pluralName = lastNormalizedWord
      ? [...normalizedWords, pluralize(lastNormalizedWord)].join(' ')
      : undefined

    // Phase 1: Search semantic candidates (direct, alias, normalized + plural,
    // alias-normalized). A candidate wins only on a higher score.
    let matches: Awaited<ReturnType<typeof fuzzySearchIngredient>> = []
    const matchesByCandidate = new Map<string, typeof matches>()
    for (const candidate of candidateNames) {
      const candidateMatches = await fuzzySearchIngredient(
        candidate,
        candidate === normalizedName ? { ...searchOptions, pluralName } : searchOptions,
      )
      matchesByCandidate.set(candidate, candidateMatches)
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
          // while allowing "sauce" → "soy sauce" and "bread" → "bread". Compared against
          // the name the match was made on, so a translation match can pass (HON-912).
          const matchedWords = new Set(fallbackMatches[0].matchedName.toLowerCase().split(/\s+/))
          if (matchedWords.has(lastWord)) {
            matches = fallbackMatches
          }
        }
      }
    }

    // A form word the winning row lacks must not save sure as the bare row (HON-1554)
    const guarded = await applyFormGuard({
      directName,
      aliasName,
      normalizedName,
      normalizedAliasName,
      matches,
      matchesByCandidate,
      search: (name) => fuzzySearchIngredient(name, searchOptions),
    })
    const formGuard = guarded.formGuard
    matches = guarded.matches

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

      let lowConfidence = similarityScore < LOW_CONFIDENCE_THRESHOLD || formGuard.action === 'flag'

      // Safety check: if primary nouns differ between extracted and matched name,
      // force low-confidence regardless of trigram score.
      // e.g., "trout fillet" → "cod fillet": trout ≠ cod → flag for review.
      // Compares against the name the match was made on, so "must pipar" matched
      // through its translation is not judged against "black pepper" (HON-912).
      // A curated synonym is the same food under another name, so its row is not
      // judged by its words: "canned diced tomatoes" is "tinned chopped tomatoes"
      // (HON-1099). The row may be found through its translation, so its own name
      // counts too (HON-1545).
      const synonymTarget = findSynonym(directName) ?? findSynonym(normalizedName)
      const isSynonymMatch =
        synonymTarget !== undefined &&
        [match.matchedName, match.name].some(
          (name) => name.toLowerCase() === synonymTarget.toLowerCase(),
        )
      // A qualified name whose match is only its bare last word is a guess, not a match:
      // "walnut butter" is not `butter`, "macadamia milk" is not `milk`. It goes to the user
      // as unsure, with the rows as alternatives, whichever phase found it, because a short
      // qualifier finds the bare row in the direct search: "nut butter" scores 0.64 against
      // `butter`. The normalized name drops a modifier, so "fresh basil" stays a sure `basil`
      // (HON-1546). A curated synonym is the same food, so it stays sure.
      if (!isSynonymMatch && isBareLastWord(normalizedName, match.matchedName)) lowConfidence = true
      // A form row the guard chose already names the form and the food, so its words are
      // not judged again: "suitsutatud paprika" is `smoked paprika` as "suitsupaprikapulber"
      const isFormRow = formGuard.action === 'use'
      if (!lowConfidence && !isSynonymMatch && directName.includes(' ')) {
        if (!isFormRow && primaryNounsDiffer(directName, match.matchedName)) lowConfidence = true

        if (isOtherCutFillet(normalizedName, match.matchedName)) lowConfidence = true
      }

      // Get alternatives for disambiguation if low confidence
      const alternativeRows = formGuard.action === 'flag' ? formGuard.alternatives : matches
      const alternatives = lowConfidence
        ? alternativeRows.slice(0, 3).map((m) => ({
            id: m.id,
            name: m.name,
            category: m.category,
            defaultUnit: m.defaultUnit,
            measuredByVolume: m.measuredByVolume,
            gramsPerPiece: m.gramsPerPiece,
            protein: m.protein,
            proteinType: m.proteinType,
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
        originalPhrase = MIXED_VAGUE_PHRASE
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
          measuredByVolume: match.measuredByVolume,
          gramsPerPiece: match.gramsPerPiece,
          calories: match.calories,
          protein: match.protein,
          carbs: match.carbs,
          fat: match.fat,
          proteinType: match.proteinType,
        },
        convertedQuantity,
        quantityWarning,
        isVague,
        originalPhrase,
        matchedName: match.matchedName,
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
 * A merged row is unsure when either of its rows was, so a guessed match that
 * lands on the same ingredient as a sure one still needs a check (HON-1305).
 * It then carries the unsure row's name, the one the user has to decide on.
 */
function unsureOf(existing: MatchedIngredient, result: MatchedIngredient) {
  const takeResult = result.lowConfidence && !existing.lowConfidence
  return {
    lowConfidence: existing.lowConfidence || result.lowConfidence,
    alternatives: existing.alternatives ?? result.alternatives,
    ...(takeResult && { extractedName: result.extractedName }),
  }
}

/**
 * Merge duplicate matched ingredients (same ingredientId) into single rows.
 * Quantities are summed. If either row is vague, the merged row is vague with no quantity;
 * if either is low-confidence, so is the merged row.
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
        ...unsureOf(existing, result),
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
        ...unsureOf(existing, result),
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
