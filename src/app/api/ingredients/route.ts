import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { IngredientCategory } from '@/generated/prisma/enums'

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

export async function GET(request: NextRequest) {
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
    const ingredients = await prisma.ingredient.findMany({
      where: {
        name: {
          contains: search,
          mode: 'insensitive',
        },
        ...(category && { category }),
      },
      select: {
        id: true,
        name: true,
        category: true,
        defaultUnit: true,
      },
      orderBy: { name: 'asc' },
      take: limit,
    })

    return NextResponse.json({ ingredients })
  } catch (error) {
    console.error('Failed to search ingredients:', error)
    return NextResponse.json({ error: 'Failed to search ingredients' }, { status: 500 })
  }
}
