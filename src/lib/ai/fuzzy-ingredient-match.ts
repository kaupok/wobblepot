import { prisma } from '@/lib/prisma'
import type { IngredientCategory, Unit } from '@/generated/prisma/enums'
import { DEFAULT_LOCALE } from '@/lib/i18n/locales'

/**
 * Minimum similarity score for fuzzy ingredient matching.
 * Raised from 0.3 to 0.45 to prevent false positives like "baking powder" → "curry powder".
 */
export const SIMILARITY_THRESHOLD = 0.45

export type IngredientMatchSource = 'global' | 'household' | 'translation'

export type FuzzyIngredientMatch = {
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
  similarity: number
  source: IngredientMatchSource
  /**
   * The name the trigram match was made on: `name` for global and household rows,
   * the translation's name for translation rows. Word-level checks compare against
   * this, not the canonical English `name`.
   */
  matchedName: string
}

/** Rows fetched from SQL before ranking. Wider than the result so dedupe has room. */
const CANDIDATE_LIMIT = 12
const RESULT_LIMIT = 4

/**
 * Tie-break order at equal similarity. In a non-default locale the household's
 * input is in that language, so a hit on the translation name is the stronger
 * signal: Estonian "paprika" is an exact hit on both the spice's English name and
 * bell pepper's translation, and must resolve to bell pepper.
 */
function sourceRank(source: IngredientMatchSource, isDefaultLocale: boolean): number {
  if (isDefaultLocale) return source === 'global' ? 0 : source === 'household' ? 1 : 2
  return source === 'translation' ? 0 : source === 'household' ? 1 : 2
}

/**
 * Rank fuzzy-search candidates: similarity first, source only as the tie-breaker,
 * one row per ingredient (the best-ranked one), capped at four.
 */
export function rankFuzzyMatches(
  rows: FuzzyIngredientMatch[],
  locale: string = DEFAULT_LOCALE,
): FuzzyIngredientMatch[] {
  const isDefaultLocale = locale === DEFAULT_LOCALE
  const sorted = [...rows].sort(
    (a, b) =>
      b.similarity - a.similarity ||
      sourceRank(a.source, isDefaultLocale) - sourceRank(b.source, isDefaultLocale),
  )

  const seen = new Set<string>()
  const ranked: FuzzyIngredientMatch[] = []
  for (const row of sorted) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    ranked.push(row)
    if (ranked.length === RESULT_LIMIT) break
  }
  return ranked
}

/**
 * Perform fuzzy search for an ingredient name using pg_trgm across:
 *   1. Global pool (`householdId IS NULL`)
 *   2. Household-scoped pool (`householdId = ?`) — only if `householdId` provided
 *   3. Translation table for the requested locale — only if `locale` non-default
 *
 * Results are ranked by similarity, with source as the tie-breaker only (see
 * `rankFuzzyMatches`), so an exact Estonian translation beats a partial English
 * hit (HON-912). The returned `name` is always the canonical English
 * `ingredient.name` even when matched via a translation row — callers translate
 * for display via `@/lib/i18n/content`. `matchedName` carries the name the match
 * was made on.
 */
export async function fuzzySearchIngredient(
  searchName: string,
  options: { householdId?: string | null; locale?: string } = {},
): Promise<FuzzyIngredientMatch[]> {
  const householdIdParam = options.householdId ?? null
  const locale = options.locale ?? DEFAULT_LOCALE
  const localeParam = locale === DEFAULT_LOCALE ? null : locale

  const rows = await prisma.$queryRaw<FuzzyIngredientMatch[]>`
    SELECT * FROM (
      SELECT
        id,
        name,
        category,
        subcategory,
        "defaultUnit",
        "gramsPerPiece",
        calories,
        protein,
        carbs,
        fat,
        similarity(name, ${searchName}) AS similarity,
        'global'::text AS source,
        name AS "matchedName"
      FROM "ingredient"
      WHERE "householdId" IS NULL
        AND similarity(name, ${searchName}) >= ${SIMILARITY_THRESHOLD}

      UNION ALL

      SELECT
        id,
        name,
        category,
        subcategory,
        "defaultUnit",
        "gramsPerPiece",
        calories,
        protein,
        carbs,
        fat,
        similarity(name, ${searchName}) AS similarity,
        'household'::text AS source,
        name AS "matchedName"
      FROM "ingredient"
      WHERE "householdId" = ${householdIdParam}::text
        AND similarity(name, ${searchName}) >= ${SIMILARITY_THRESHOLD}

      UNION ALL

      SELECT
        i.id,
        i.name,
        i.category,
        i.subcategory,
        i."defaultUnit",
        i."gramsPerPiece",
        i.calories,
        i.protein,
        i.carbs,
        i.fat,
        similarity(t.name, ${searchName}) AS similarity,
        'translation'::text AS source,
        t.name AS "matchedName"
      FROM "ingredient_translation" t
      INNER JOIN "ingredient" i ON i.id = t."ingredientId"
      WHERE t.locale = ${localeParam}::text
        AND similarity(t.name, ${searchName}) >= ${SIMILARITY_THRESHOLD}
        AND (i."householdId" IS NULL OR i."householdId" = ${householdIdParam}::text)
    ) AS results
    ORDER BY similarity DESC
    LIMIT ${CANDIDATE_LIMIT}
  `
  return rankFuzzyMatches(rows, locale)
}
