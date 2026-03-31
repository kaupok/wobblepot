/**
 * Ingredient Coverage Audit
 *
 * Takes a list of ingredient names and tests each against the real
 * matching pipeline (aliases → normalization → trigram fuzzy search).
 *
 * Usage:
 *   npx tsx scripts/audit-ingredients/audit-coverage.ts < ingredient-names.txt
 *   npx tsx scripts/audit-ingredients/audit-coverage.ts --file=ingredient-names.txt
 *
 * Input: One ingredient name per line
 * Output: JSON report to stdout
 */

import 'dotenv/config'
import { readFileSync } from 'fs'
import { prisma } from '../../src/lib/prisma'
import { applyIngredientAlias } from '../../src/lib/ingredient-aliases'
import { normalizeIngredientName, extractLastWord } from '../../src/lib/normalize-ingredient'

// ============================================
// TYPES
// ============================================

interface MatchAttempt {
  candidateName: string
  method: 'direct' | 'alias' | 'normalized' | 'normalized-alias' | 'last-word'
  results: Array<{ name: string; similarity: number }>
}

interface CoverageResult {
  inputName: string
  status: 'exact' | 'alias' | 'fuzzy-high' | 'fuzzy-low' | 'unmatched'
  bestMatch: {
    name: string
    similarity: number
    method: string
  } | null
  attempts: MatchAttempt[]
  lowConfidence: boolean
  nounMismatch: boolean
}

interface CoverageReport {
  timestamp: string
  totalTested: number
  results: CoverageResult[]
  summary: {
    exact: number
    alias: number
    fuzzyHigh: number
    fuzzyLow: number
    unmatched: number
  }
  unmatchedList: string[]
  lowConfidenceList: Array<{ input: string; matchedTo: string; similarity: number }>
}

// ============================================
// CONSTANTS (matching parse-recipe.ts thresholds)
// ============================================

const SIMILARITY_THRESHOLD = 0.45
const LOW_CONFIDENCE_THRESHOLD = 0.6
const VERY_LOW_CONFIDENCE_THRESHOLD = 0.55

// ============================================
// DATABASE FUNCTIONS (with query cache)
// ============================================

const fuzzyCache = new Map<string, Array<{ name: string; similarity: number }>>()
const exactCache = new Map<string, boolean>()

async function fuzzySearch(
  searchName: string,
): Promise<Array<{ name: string; similarity: number }>> {
  const cached = fuzzyCache.get(searchName)
  if (cached) return cached
  const results = await prisma.$queryRaw<Array<{ name: string; similarity: number }>>`
    SELECT name, similarity(name, ${searchName}) as similarity
    FROM "ingredient"
    WHERE similarity(name, ${searchName}) >= ${SIMILARITY_THRESHOLD}
    ORDER BY similarity DESC
    LIMIT 4
  `
  fuzzyCache.set(searchName, results)
  return results
}

async function exactSearch(name: string): Promise<boolean> {
  const key = name.toLowerCase()
  const cached = exactCache.get(key)
  if (cached !== undefined) return cached
  const result = await prisma.ingredient.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { name: true },
  })
  const found = result !== null
  exactCache.set(key, found)
  return found
}

// ============================================
// MATCHING PIPELINE (mirrors parse-recipe.ts)
// ============================================

/**
 * Extract content words for comparison. For compound ingredients like
 * "trout fillet" vs "cod fillet", comparing just the last word ("fillet")
 * would miss the species mismatch. Instead, compare all words.
 */
function getContentWords(name: string): Set<string> {
  return new Set(name.toLowerCase().split(/\s+/).filter(Boolean))
}

async function testIngredient(inputName: string): Promise<CoverageResult> {
  const attempts: MatchAttempt[] = []
  let bestMatch: CoverageResult['bestMatch'] = null
  let bestSimilarity = 0

  // Phase 1: Build candidate names (same as parse-recipe.ts)
  const directName = inputName.toLowerCase().trim()
  const aliasName = applyIngredientAlias(directName)
  const normalizedName = normalizeIngredientName(directName)
  const normalizedAliasName = applyIngredientAlias(normalizedName)

  const candidates = new Map<string, string>()
  candidates.set(directName, 'direct')
  if (aliasName !== directName) candidates.set(aliasName, 'alias')
  if (normalizedName !== directName && !candidates.has(normalizedName))
    candidates.set(normalizedName, 'normalized')
  if (
    normalizedAliasName !== directName &&
    normalizedAliasName !== normalizedName &&
    !candidates.has(normalizedAliasName)
  )
    candidates.set(normalizedAliasName, 'normalized-alias')

  // Check exact match first
  for (const [candidate, method] of candidates) {
    const isExact = await exactSearch(candidate)
    if (isExact) {
      return {
        inputName,
        status: method === 'alias' || method === 'normalized-alias' ? 'alias' : 'exact',
        bestMatch: { name: candidate, similarity: 1.0, method },
        attempts: [],
        lowConfidence: false,
        nounMismatch: false,
      }
    }
  }

  // Phase 2: Fuzzy search each candidate
  for (const [candidate, method] of candidates) {
    const results = await fuzzySearch(candidate)
    attempts.push({
      candidateName: candidate,
      method: method as MatchAttempt['method'],
      results: results.map((r) => ({
        name: r.name,
        similarity: Number(r.similarity),
      })),
    })

    if (results.length > 0 && Number(results[0]!.similarity) > bestSimilarity) {
      bestSimilarity = Number(results[0]!.similarity)
      bestMatch = {
        name: results[0]!.name,
        similarity: bestSimilarity,
        method,
      }
    }
  }

  // Phase 3: Last-word fallback (only if no good match)
  if (bestSimilarity < VERY_LOW_CONFIDENCE_THRESHOLD) {
    const lastWord = extractLastWord(directName)
    if (lastWord && !candidates.has(lastWord)) {
      const results = await fuzzySearch(lastWord)
      attempts.push({
        candidateName: lastWord,
        method: 'last-word',
        results: results.map((r) => ({
          name: r.name,
          similarity: Number(r.similarity),
        })),
      })

      if (results.length > 0 && Number(results[0]!.similarity) > bestSimilarity) {
        bestSimilarity = Number(results[0]!.similarity)
        bestMatch = {
          name: results[0]!.name,
          similarity: bestSimilarity,
          method: 'last-word',
        }
      }
    }
  }

  // Classify result — check if all words in the input appear in the match
  // "trout fillet" → {"trout","fillet"} vs "cod fillet" → {"cod","fillet"}
  // Shared words: {"fillet"}, input-only: {"trout"} → mismatch
  const inputWords = getContentWords(directName)
  const matchWords = bestMatch ? getContentWords(bestMatch.name) : new Set<string>()
  const nounMismatch =
    bestMatch !== null && [...inputWords].some((w) => !matchWords.has(w) && w.length > 2)

  let status: CoverageResult['status']
  if (bestSimilarity >= LOW_CONFIDENCE_THRESHOLD && !nounMismatch) {
    status = 'fuzzy-high'
  } else if (bestSimilarity >= VERY_LOW_CONFIDENCE_THRESHOLD) {
    status = 'fuzzy-low'
  } else {
    status = 'unmatched'
  }

  return {
    inputName,
    status,
    bestMatch,
    attempts,
    lowConfidence: status === 'fuzzy-low' || nounMismatch,
    nounMismatch,
  }
}

// ============================================
// MAIN
// ============================================

async function main() {
  // Read ingredient names from file arg or stdin
  let input: string
  const fileArg = process.argv.find((a) => a.startsWith('--file='))
  if (fileArg) {
    input = readFileSync(fileArg.slice('--file='.length), 'utf-8')
  } else {
    input = readFileSync('/dev/stdin', 'utf-8')
  }

  const names = [
    ...new Set(
      input
        .split('\n')
        .map((l) => l.trim().toLowerCase())
        .filter((l) => l.length > 0 && !l.startsWith('#')),
    ),
  ]

  console.error(`Testing ${names.length} unique ingredient names...`)

  const results: CoverageResult[] = []
  for (const name of names) {
    const result = await testIngredient(name)
    results.push(result)

    // Progress indicator to stderr
    const icon =
      result.status === 'exact' || result.status === 'alias'
        ? '✓'
        : result.status === 'fuzzy-high'
          ? '~'
          : result.status === 'fuzzy-low'
            ? '?'
            : '✗'
    console.error(
      `  ${icon} ${name}${result.bestMatch ? ` → ${result.bestMatch.name} (${result.bestMatch.similarity.toFixed(2)})` : ' → NO MATCH'}`,
    )
  }

  const report: CoverageReport = {
    timestamp: new Date().toISOString(),
    totalTested: names.length,
    results,
    summary: {
      exact: results.filter((r) => r.status === 'exact').length,
      alias: results.filter((r) => r.status === 'alias').length,
      fuzzyHigh: results.filter((r) => r.status === 'fuzzy-high').length,
      fuzzyLow: results.filter((r) => r.status === 'fuzzy-low').length,
      unmatched: results.filter((r) => r.status === 'unmatched').length,
    },
    unmatchedList: results.filter((r) => r.status === 'unmatched').map((r) => r.inputName),
    lowConfidenceList: results
      .filter((r) => r.lowConfidence && r.bestMatch)
      .map((r) => ({
        input: r.inputName,
        matchedTo: r.bestMatch!.name,
        similarity: r.bestMatch!.similarity,
      })),
  }

  // JSON report to stdout
  console.log(JSON.stringify(report, null, 2))
}

main()
  .catch((e) => {
    console.error('Coverage audit failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
