import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'
import { loadPantry } from '@/lib/meal-planning/load-pantry'
import { captureApiError } from '@/lib/errors'

// `quantity` floors at 0: `0` is a valid tracked state ("none left, still
// tracked"), `null` means "have some, amount unknown" (the deduction path
// treats it as fully consumed), and a negative would render on /shopping as a
// real on-hand amount and inflate the shopping quantity: `computeShoppingList`
// (src/lib/meal-planning/shopping-list.ts:279) and
// `computeRollingWindowShoppingList` (:475) both net via
// `Math.max(0, neededQty - pantry.quantity)`, which turns "500 needed, -500 on
// hand" into 1000 to buy. The needed-quantity aggregation in `loadPantry` is
// meal-plan-only and never reads `quantity`, so it is not the consumer at risk.
const createPantryItemSchema = z.object({
  ingredientId: z.string().min(1),
  quantity: z.number().min(0).nullable().optional(),
  isStaple: z.boolean().optional().default(false),
})

export async function GET(request: NextRequest) {
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

  // Parse optional days param for needed quantity calculation
  const daysParam = request.nextUrl.searchParams.get('days')
  const days = daysParam === '7' ? 7 : daysParam === '14' ? 14 : null

  try {
    return NextResponse.json(await loadPantry(household, { days }))
  } catch (error) {
    captureApiError(error, { route: '/api/pantry', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to fetch pantry items' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = createPantryItemSchema.safeParse(body)

    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
    }

    const membership = await getHouseholdMembership(session.user.id)

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    // Verify ingredient exists
    const ingredient = await prisma.ingredient.findUnique({
      where: { id: parsed.data.ingredientId },
      select: { id: true, name: true, category: true, defaultUnit: true },
    })

    if (!ingredient) {
      return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })
    }

    // Check if item already exists (unique constraint: householdId + ingredientId)
    const existing = await prisma.pantryItem.findUnique({
      where: {
        householdId_ingredientId: {
          householdId: membership.householdId,
          ingredientId: parsed.data.ingredientId,
        },
      },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'Ingredient already in pantry', existingId: existing.id },
        { status: 409 },
      )
    }

    const pantryItem = await prisma.pantryItem.create({
      data: {
        householdId: membership.householdId,
        ingredientId: parsed.data.ingredientId,
        quantity: parsed.data.quantity ?? null,
        isStaple: parsed.data.isStaple,
      },
      include: {
        ingredient: {
          select: {
            id: true,
            name: true,
            category: true,
            defaultUnit: true,
          },
        },
      },
    })

    return NextResponse.json(
      {
        id: pantryItem.id,
        ingredientId: pantryItem.ingredientId,
        ingredient: pantryItem.ingredient,
        quantity: pantryItem.quantity,
        isStaple: pantryItem.isStaple,
        updatedAt: pantryItem.updatedAt,
      },
      { status: 201 },
    )
  } catch (error) {
    captureApiError(error, { route: '/api/pantry', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to add pantry item' }, { status: 500 })
  }
}
