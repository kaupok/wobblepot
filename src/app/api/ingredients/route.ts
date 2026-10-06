import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import type { IngredientCategory, Unit } from '@/generated/prisma/enums'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { ingredientNameMatchSql } from '@/lib/i18n/ingredient-search-sql'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { findSynonymMatches } from '@/lib/ingredient-synonym-match'

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50
/**
 * Minimum `similarity()` for a match. Unlike the meal search's
 * `word_similarity()` (HON-942), `similarity()` divides by the trigrams of both
 * strings, so a short query sharing only a name's first-letter trigram stays
 * well below this: a two-letter query has 3 trigrams and the shortest name has
 * at least 2, so one shared trigram scores at most 1 / (3 + 2 − 1) = 0.25.
 */
const SIMILARITY_THRESHOLD = 0.3
/**
 * Score for a row found by another English name that starts with the term
 * (HON-1100). Such a hit is an exact, curated match, but the row's own name can
 * share almost no trigrams with the term ("plain fl" vs "all-purpose flour"),
 * so it gets a fixed score: above any partial name hit, below an exact name hit
 * (similarity 1). Typing "plain fl" then lists all-purpose flour first, and
 * typing a row's full name still puts that row on top.
 *
 * A term that only starts a later word of the synonym ("pepper" in "red
 * pepper") is a generic word, not that kind of match, so the row keeps its own
 * name score and falls into the normal order.
 */
const SYNONYM_SCORE = 0.9

interface IngredientSearchResult {
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

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const search = searchParams.get('search')?.trim() || ''
  const category = searchParams.get('category') as IngredientCategory | null
  const limit = Math.min(
    Math.max(1, parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
    MAX_LIMIT,
  )

  // Empty search returns empty array (not all ingredients)
  if (!search) {
    return NextResponse.json({ ingredients: [] })
  }

  try {
    // Use pg_trgm similarity search for fuzzy matching
    // The similarity() function returns a value between 0 and 1
    // We filter results with similarity >= threshold and order by relevance
    const categoryFilter = category
      ? Prisma.sql`AND i.category = ${category}::"IngredientCategory"`
      : Prisma.empty

    // Offer global ingredients and the caller's own household's, never another
    // household's: the write routes reject those (HON-889). A user with no
    // household gets globals only, since `= NULL` matches nothing.
    const membership = await getHouseholdMembership(session.user.id)
    const householdId = membership?.householdId ?? null

    // Match and return the name the household sees on screen, not only the
    // English one (HON-911). The household's locale, never Accept-Language.
    const locale = resolveHouseholdLocale(membership?.household)
    const match = ingredientNameMatchSql(search, locale)

    const synonymMatches = findSynonymMatches(search)

    const [nameHits, synonymRows] = await Promise.all([
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
        ? prisma.$queryRaw<(IngredientSearchResult & { poolName: string })[]>`
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

    // A row the trigram search already found by its own name keeps no
    // `matchedAs`, and is not listed twice.
    const foundIds = new Set(nameHits.map((row) => row.id))
    const synonymByTarget = new Map(synonymMatches.map((m) => [m.target, m]))
    const synonymHits: IngredientSearchResult[] = synonymRows
      .filter((row) => !foundIds.has(row.id))
      .map(({ poolName, similarity, ...row }) => {
        const hit = synonymByTarget.get(poolName)
        return {
          ...row,
          similarity: hit?.byKeyStart ? SYNONYM_SCORE : similarity,
          matchedAs: hit?.synonym,
        }
      })

    // Without a synonym hit, keep the database's order untouched.
    const ingredients =
      synonymHits.length === 0
        ? nameHits
        : [...nameHits, ...synonymHits]
            .sort((a, b) => b.similarity - a.similarity || a.name.localeCompare(b.name))
            .slice(0, limit)

    return NextResponse.json({ ingredients })
  } catch (error) {
    captureApiError(error, { route: '/api/ingredients', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to search ingredients' }, { status: 500 })
  }
}
