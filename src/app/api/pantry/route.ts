import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'
import { getStartOfTodayInTimezone } from '@/lib/meal-planning/dates'
import { Unit } from '@/generated/prisma/enums'

const createPantryItemSchema = z.object({
  ingredientId: z.string().min(1),
  quantity: z.number().nullable().optional(),
  isStaple: z.boolean().optional().default(false),
})

/**
 * Format quantity for display in pantry needed quantities.
 * - Pieces: convert grams to pieces using gramsPerPiece, round up
 * - Grams: show as "Xg" or "X.Xkg" for >= 1000g
 */
function formatQuantity(qtyInGrams: number, unit: Unit, gramsPerPiece: number | null): string {
  if (unit === 'piece') {
    // Convert grams to pieces, round up to ensure sufficient quantity
    if (gramsPerPiece && gramsPerPiece > 0) {
      const pieces = Math.ceil(qtyInGrams / gramsPerPiece)
      return String(pieces)
    }
    // Fallback: if no gramsPerPiece, show as grams
    return `${Math.round(qtyInGrams)}g`
  }
  // Grams
  if (qtyInGrams >= 1000) {
    const kg = qtyInGrams / 1000
    return kg % 1 === 0 ? `${Math.floor(kg)}kg` : `${kg.toFixed(1)}kg`
  }
  return `${Math.round(qtyInGrams)}g`
}

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
  const days = daysParam === '7' || daysParam === '14' ? parseInt(daysParam, 10) : null

  const pantryItems = await prisma.pantryItem.findMany({
    where: { householdId: household.id },
    include: {
      ingredient: {
        select: {
          id: true,
          name: true,
          category: true,
          defaultUnit: true,
          gramsPerPiece: true,
        },
      },
    },
    orderBy: [{ isStaple: 'desc' }, { ingredient: { name: 'asc' } }],
  })

  // If days param is provided, compute needed quantities from meal plans
  const neededQuantities: Map<string, number> = new Map()

  if (days) {
    const startOfToday = getStartOfTodayInTimezone(household.timezone)
    const endDate = new Date(startOfToday)
    endDate.setDate(endDate.getDate() + days)

    // Get all planned meal entries in the window
    const planEntries = await prisma.mealPlanEntry.findMany({
      where: {
        plan: {
          householdId: household.id,
        },
        status: 'planned',
        date: {
          gte: startOfToday,
          lt: endDate,
        },
      },
      include: {
        meal: {
          include: {
            components: {
              select: {
                ingredientId: true,
                quantityPerServing: true,
              },
            },
          },
        },
      },
    })

    // Get household size
    const memberCount = await prisma.householdMember.count({
      where: { householdId: household.id },
    })
    const householdSize = memberCount > 0 ? memberCount : 2

    // Aggregate quantities per ingredient
    for (const entry of planEntries) {
      if (!entry.meal) continue
      for (const component of entry.meal.components) {
        const qty = component.quantityPerServing * householdSize
        const existing = neededQuantities.get(component.ingredientId) ?? 0
        neededQuantities.set(component.ingredientId, existing + qty)
      }
    }
  }

  const items = pantryItems.map((item) => {
    const neededQty = neededQuantities.get(item.ingredientId)
    return {
      id: item.id,
      ingredientId: item.ingredientId,
      ingredient: {
        id: item.ingredient.id,
        name: item.ingredient.name,
        category: item.ingredient.category,
        defaultUnit: item.ingredient.defaultUnit,
      },
      quantity: item.quantity,
      isStaple: item.isStaple,
      updatedAt: item.updatedAt,
      ...(days && neededQty !== undefined && neededQty > 0
        ? {
            neededQuantity: neededQty,
            neededDisplayQuantity: formatQuantity(
              neededQty,
              item.ingredient.defaultUnit,
              item.ingredient.gramsPerPiece,
            ),
            windowDays: days,
          }
        : {}),
    }
  })

  return NextResponse.json({ items, windowDays: days })
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
}
