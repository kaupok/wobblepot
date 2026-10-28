import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { loadPantry } from '@/lib/meal-planning/load-pantry'
import { captureApiError } from '@/lib/errors'
import { createPantryItem, pantryQuantitySchema } from '@/lib/pantry/pantry-items'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'

// The quantity rule (`>= 0` or `null`) is `pantryQuantitySchema`'s.
const createPantryItemSchema = z.object({
  ingredientId: z.string().min(1),
  quantity: pantryQuantitySchema.optional(),
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

    const outcome = await createPantryItem(membership.household, {
      ingredientId: parsed.data.ingredientId,
      quantity: parsed.data.quantity ?? null,
      isStaple: parsed.data.isStaple,
    })

    if (outcome.status === 'ingredient_not_found') {
      return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })
    }

    if (outcome.status === 'exists') {
      return NextResponse.json(
        { error: 'Ingredient already in pantry', existingId: outcome.existingId },
        { status: 409 },
      )
    }

    const { item } = outcome
    return NextResponse.json(
      {
        id: item.id,
        ingredientId: item.ingredientId,
        ingredient: {
          id: item.ingredient.id,
          name: item.ingredient.name,
          category: item.ingredient.category,
          defaultUnit: item.ingredient.defaultUnit,
          // The unit the pantry row shows an amount in, as `loadPantry` sends it.
          displayUnit: displayUnit(item.ingredient),
        },
        quantity: item.quantity,
        isStaple: item.isStaple,
        updatedAt: item.updatedAt,
      },
      { status: 201 },
    )
  } catch (error) {
    captureApiError(error, { route: '/api/pantry', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to add pantry item' }, { status: 500 })
  }
}
