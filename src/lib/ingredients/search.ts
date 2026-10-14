import 'server-only'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import type { IngredientCategory, Unit } from '@/generated/prisma/enums'
import { ingredientNameMatchSql } from '@/lib/i18n/ingredient-search-sql'
import { findSynonymMatches, type SynonymMatch } from '@/lib/ingredient-synonym-match'

/**
 * The ingredient picker's search, behind `GET /api/ingredients` (HON-1209).
 * The route owns the session, the household and the query string; this module
 * runs the pg_trgm queries and ranks their rows, and is tested against a
 * database in `search.db.test.ts`.
 */

/**
 * Minimum `similarity()` for a match. Unlike the meal search's
 * `word_similarity()` (HON-942), `similarity()` divides by the trigrams of both
 * strings, so a short query sharing only a name's first-letter trigram stays
 * well below this: a two-letter query has 3 trigrams and the shortest name has
 * at least 2, so one shared trigram scores at most 1 / (3 + 2 − 1) = 0.25.
 */
const SIMILARITY_THRESHOLD = 0.3
/**
 * Score for a strong synonym hit (HON-1100): the term picks out one other
 * English name, "zucc" or "all-purpose f" (`SynonymMatch.strong`). Such a hit is an
 * exact, curated match, but the row's own name can share almost no trigrams
 * with the term ("all-purpose fl" vs "plain flour"), so it gets a fixed score:
 * above any partial name hit, below an exact name hit (similarity 1). Typing
 * "all-purpose fl" then lists plain flour first, and typing a row's full name
 * still puts that row on top.
 *
 * A term that is only a generic word of the synonym ("all-purpose", "sweet", or
 * "pepper" in "red bell pepper") is not that kind of match, so the row keeps its own
 * name score and falls into the normal order.
 */
export const SYNONYM_SCORE = 0.9

export interface IngredientSearchResult {
  id: string
  name: string
  category: IngredientCategory
  defaultUnit: Unit
  gramsPerPiece: number | null
  measuredByVolume: boolean
  calories: number
  protein: number
  carbs: number
  fat: number
  similarity: number
  /** The other English name the term matched; absent on a row found by its own name. */
  matchedAs?: string
}

/** A synonym query row: the result plus the English pool name the synonym named. */
export type SynonymRow = Omit<IngredientSearchResult, 'matchedAs'> & { poolName: string }

export interface IngredientSearch {
  /** The trimmed, non-empty term. */
  search: string
  category: IngredientCategory | null
  limit: number
  /**
   * The caller's household, whose own ingredients are offered with the global
   * ones; `null` offers globals only.
   */
  householdId: string | null
  /** The household's locale: its names are matched and returned (HON-911). */
  locale: string
}

/**
 * Global ingredients and the household's own whose name, in English or in the
 * household's language, is like `search`, plus the global rows `search` names
 * by another English name (HON-1100). Best match first, at most `limit`.
 */
export async function searchIngredients({
  search,
  category,
  limit,
  householdId,
  locale,
}: IngredientSearch): Promise<IngredientSearchResult[]> {
  const categoryFilter = category
    ? Prisma.sql`AND i.category = ${category}::"IngredientCategory"`
    : Prisma.empty

  const match = ingredientNameMatchSql(search, locale)
  const synonymMatches = findSynonymMatches(search)

  const [nameHits, synonymRows] = await Promise.all([
    // Offer global ingredients and the caller's own household's, never another
    // household's: the write routes reject those (HON-889). With no household,
    // `= NULL` matches nothing, which leaves globals only.
    prisma.$queryRaw<IngredientSearchResult[]>`
      SELECT
        i.id,
        ${match.displayName} as name,
        i.category,
        i."defaultUnit",
        i."gramsPerPiece",
        i."measuredByVolume",
        i.calories,
        i.protein,
        i.carbs,
        i.fat,
        ${match.score} as similarity
      FROM "ingredient" i
      ${match.join}
      WHERE ${match.score} >= ${SIMILARITY_THRESHOLD}
        AND (i."householdId" IS NULL OR i."householdId" = ${householdId}::text)
      ${categoryFilter}
      ORDER BY similarity DESC, name ASC
      LIMIT ${limit}
    `,
    // Synonyms name global rows only, by their English pool name, so this
    // matches `i.name` exactly and still returns the household's display name.
    synonymMatches.length > 0
      ? prisma.$queryRaw<SynonymRow[]>`
          SELECT
            i.id,
            i.name as "poolName",
            ${match.displayName} as name,
            i.category,
            i."defaultUnit",
            i."gramsPerPiece",
            i."measuredByVolume",
            i.calories,
            i.protein,
            i.carbs,
            i.fat,
            ${match.score} as similarity
          FROM "ingredient" i
          ${match.join}
          WHERE i.name IN (${Prisma.join(synonymMatches.map((m) => m.target))})
            AND i."householdId" IS NULL
          ${categoryFilter}
        `
      : Promise.resolve([]),
  ])

  return rankSearchHits(nameHits, synonymRows, synonymMatches, limit)
}

/**
 * Merges the name hits, in the database's order, with the synonym rows. A
 * strong synonym hit scores `SYNONYM_SCORE`; a weak one keeps its name score.
 */
export function rankSearchHits(
  nameHits: IngredientSearchResult[],
  synonymRows: SynonymRow[],
  synonymMatches: SynonymMatch[],
  limit: number,
): IngredientSearchResult[] {
  const synonymByTarget = new Map(synonymMatches.map((m) => [m.target, m]))
  const synonymHits = new Map<string, IngredientSearchResult>(
    synonymRows.map(({ poolName, similarity, ...row }) => {
      const hit = synonymByTarget.get(poolName)
      const score = hit?.strong ? SYNONYM_SCORE : similarity
      return [row.id, { ...row, similarity: score, matchedAs: hit?.synonym }]
    }),
  )

  // A row is listed once. It keeps its name hit, without `matchedAs`, unless
  // a strong synonym hit outranks that: typing "all-purpose flour" scores
  // plain flour low by name, below the other flours.
  let changed = false
  const merged = nameHits.map((row) => {
    const hit = synonymHits.get(row.id)
    synonymHits.delete(row.id)
    if (hit && hit.similarity > row.similarity) {
      changed = true
      return hit
    }
    return row
  })

  // Without a synonym hit, keep the database's order untouched.
  return !changed && synonymHits.size === 0
    ? nameHits
    : [...merged, ...synonymHits.values()]
        .sort((a, b) => b.similarity - a.similarity || a.name.localeCompare(b.name))
        .slice(0, limit)
}
