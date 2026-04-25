import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import type { IngredientCategory, Unit } from '@/generated/prisma/enums'
import { captureApiError } from '@/lib/errors'

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50
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
      ? Prisma.sql`AND category = ${category}::"IngredientCategory"`
      : Prisma.empty

    const ingredients = await prisma.$queryRaw<IngredientSearchResult[]>`
      SELECT
        id,
        name,
        category,
        "defaultUnit",
        "gramsPerPiece",
        calories,
        protein,
        carbs,
        fat,
        similarity(name, ${search}) as similarity
      FROM "ingredient"
      WHERE similarity(name, ${search}) >= ${SIMILARITY_THRESHOLD}
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
