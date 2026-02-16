import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { getHouseholdMembership } from '@/lib/household'

const AUTO_MATCH_THRESHOLD = 0.4

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
})

/**
 * POST /api/shopping-list/custom
 *
 * Create a custom shopping list item. Auto-matches against the ingredient DB
 * using fuzzy search. Returns the created item with match info.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const { household } = membership

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = createSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const { name } = parsed.data

  // Check for duplicate name in this household
  const existing = await prisma.customShoppingItem.findUnique({
    where: {
      householdId_name: {
        householdId: household.id,
        name,
      },
    },
  })

  if (existing) {
    // If already exists and checked, uncheck it (re-add behavior)
    if (existing.checked) {
      const updated = await prisma.customShoppingItem.update({
        where: { id: existing.id },
        data: { checked: false },
        include: {
          ingredient: {
            select: { id: true, name: true, category: true },
          },
        },
      })
      return NextResponse.json({ item: updated }, { status: 200 })
    }
    return NextResponse.json({ error: 'Item already exists', existing }, { status: 409 })
  }

  // Auto-match against ingredient database
  let matchedIngredientId: string | null = null

  try {
    const matches = await prisma.$queryRaw<
      { id: string; name: string; category: string; similarity: number }[]
    >`
      SELECT
        id,
        name,
        category,
        similarity(name, ${name}) as similarity
      FROM "ingredient"
      WHERE similarity(name, ${name}) >= ${AUTO_MATCH_THRESHOLD}
      ORDER BY similarity DESC
      LIMIT 1
    `

    if (matches.length > 0 && matches[0]) {
      matchedIngredientId = matches[0].id
    }
  } catch {
    // If similarity search fails, create without match
  }

  try {
    const item = await prisma.customShoppingItem.create({
      data: {
        householdId: household.id,
        name,
        ingredientId: matchedIngredientId,
      },
      include: {
        ingredient: {
          select: { id: true, name: true, category: true },
        },
      },
    })

    return NextResponse.json({ item }, { status: 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'Item already exists' }, { status: 409 })
    }
    console.error('Failed to create custom shopping item:', error)
    return NextResponse.json({ error: 'Failed to create item' }, { status: 500 })
  }
}
