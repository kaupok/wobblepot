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

interface IngredientSearchResult {
  id: string
  name: string
  category: IngredientCategory
  defaultUnit: Unit
  gramsPerPiece: number | null
  calories: number
  protein: number
  carbs: number
  fat: number
  similarity: number
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

    const ingredients = await prisma.$queryRaw<IngredientSearchResult[]>`
      SELECT
        i.id,
        ${match.displayName} as name,
        i.category,
        i."defaultUnit",
        i."gramsPerPiece",
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
    `

    return NextResponse.json({ ingredients })
  } catch (error) {
    captureApiError(error, { route: '/api/ingredients', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to search ingredients' }, { status: 500 })
  }
}
