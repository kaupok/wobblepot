import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'

const purchaseSchema = z
  .object({
    ingredientId: z.string().min(1).optional(),
    ingredientIds: z.array(z.string().min(1)).optional(),
  })
  .refine((data) => data.ingredientId || data.ingredientIds, {
    message: 'Either ingredientId or ingredientIds must be provided',
  })

type PurchaseResult = {
  ingredientId: string
  action: 'created' | 'updated'
  pantryItem: {
    id: string
    ingredient: {
      id: string
      name: string
      category: string
      defaultUnit: string
    }
    quantity: number | null
    isStaple: boolean
    updatedAt: string
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const membership = await getHouseholdMembership(session.user.id)

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    const { household } = membership
    const { id: planId } = await params

    // Verify plan exists and belongs to household
    const plan = await prisma.mealPlan.findUnique({
      where: { id: planId },
      select: { id: true, householdId: true },
    })

    if (!plan) {
      return NextResponse.json({ error: 'Meal plan not found' }, { status: 404 })
    }

    if (plan.householdId !== household.id) {
      return NextResponse.json({ error: 'Access denied to this meal plan' }, { status: 403 })
    }

    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = purchaseSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    // Normalize to array
    const ingredientIds = parsed.data.ingredientIds ?? [parsed.data.ingredientId!]

    // Validate all ingredients exist
    const ingredients = await prisma.ingredient.findMany({
      where: { id: { in: ingredientIds } },
      select: { id: true },
    })

    const foundIds = new Set(ingredients.map((i) => i.id))
    const missingIds = ingredientIds.filter((id) => !foundIds.has(id))

    if (missingIds.length > 0) {
      return NextResponse.json(
        { error: 'Invalid ingredient IDs', invalidIds: missingIds },
        { status: 400 },
      )
    }

    // Get existing pantry items to determine action type
    const existingItems = await prisma.pantryItem.findMany({
      where: {
        householdId: household.id,
        ingredientId: { in: ingredientIds },
      },
      select: { id: true, ingredientId: true },
    })

    const existingMap = new Map(existingItems.map((item) => [item.ingredientId, item.id]))

    // Upsert all items in a transaction
    const results: PurchaseResult[] = await prisma.$transaction(async (tx) => {
      const upsertResults: PurchaseResult[] = []

      for (const ingredientId of ingredientIds) {
        const existingId = existingMap.get(ingredientId)
        const action = existingId ? 'updated' : 'created'

        const pantryItem = await tx.pantryItem.upsert({
          where: {
            householdId_ingredientId: {
              householdId: household.id,
              ingredientId,
            },
          },
          create: {
            householdId: household.id,
            ingredientId,
            quantity: null,
            isStaple: false,
          },
          update: {
            // Touch updatedAt to mark as recently acquired
          },
          select: {
            id: true,
            quantity: true,
            isStaple: true,
            updatedAt: true,
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

        upsertResults.push({
          ingredientId,
          action,
          pantryItem: {
            id: pantryItem.id,
            ingredient: pantryItem.ingredient,
            quantity: pantryItem.quantity,
            isStaple: pantryItem.isStaple,
            updatedAt: pantryItem.updatedAt.toISOString(),
          },
        })
      }

      return upsertResults
    })

    return NextResponse.json({ success: true, results }, { status: 200 })
  } catch (error) {
    captureApiError(error, {
      route: '/api/meal-plans/[id]/shopping-list/purchase',
      userId: session.user.id,
    })
    return NextResponse.json({ error: 'Failed to mark item as purchased' }, { status: 500 })
  }
}
