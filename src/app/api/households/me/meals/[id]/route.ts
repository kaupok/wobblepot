import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'
import { deriveProteinType } from '@/lib/meal-planning/protein'

const updateMealSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  preparationNotes: z.string().max(5000).nullable().optional(),
  sourceUrl: z.string().url().max(2000).nullable().optional(),
  timeMinutes: z.number().int().positive().max(480).nullable().optional(),
  kidFriendly: z.boolean().optional(),
  suitableFor: z
    .array(z.enum(['breakfast', 'lunch', 'dinner']))
    .min(1)
    .optional(),
  servings: z.number().int().positive().max(50).optional(),
  components: z
    .array(
      z.object({
        ingredientId: z.string().min(1),
        totalQuantity: z.number().positive(),
      }),
    )
    .min(1)
    .optional(),
})

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

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

    const meal = await prisma.meal.findFirst({
      where: {
        id,
        householdId: membership.household.id,
      },
      select: {
        id: true,
        name: true,
        description: true,
        preparationNotes: true,
        sourceUrl: true,
        timeMinutes: true,
        kidFriendly: true,
        primaryProteinType: true,
        suitableFor: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
        components: {
          select: {
            ingredientId: true,
            quantityPerServing: true,
            ingredient: {
              select: {
                id: true,
                name: true,
                category: true,
                defaultUnit: true,
                gramsPerPiece: true,
                calories: true,
                protein: true,
                carbs: true,
                fat: true,
                allergens: true,
              },
            },
          },
        },
        favoritedBy: {
          where: { householdId: membership.household.id },
          select: { id: true },
        },
      },
    })

    if (!meal) {
      return NextResponse.json({ error: 'Meal not found' }, { status: 404 })
    }

    const nutrition = meal.components.reduce(
      (acc, comp) => {
        const factor = comp.quantityPerServing / 100
        return {
          calories: acc.calories + comp.ingredient.calories * factor,
          protein: acc.protein + comp.ingredient.protein * factor,
          carbs: acc.carbs + comp.ingredient.carbs * factor,
          fat: acc.fat + comp.ingredient.fat * factor,
        }
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    )

    const allergens = [...new Set(meal.components.flatMap((comp) => comp.ingredient.allergens))]

    return NextResponse.json({
      id: meal.id,
      name: meal.name,
      description: meal.description,
      preparationNotes: meal.preparationNotes,
      sourceUrl: meal.sourceUrl,
      timeMinutes: meal.timeMinutes,
      kidFriendly: meal.kidFriendly,
      primaryProteinType: meal.primaryProteinType,
      suitableFor: meal.suitableFor,
      isCustom: true,
      isFavorite: meal.favoritedBy.length > 0,
      deletedAt: meal.deletedAt,
      createdAt: meal.createdAt,
      updatedAt: meal.updatedAt,
      components: meal.components.map((comp) => ({
        ingredientId: comp.ingredientId,
        quantityPerServing: comp.quantityPerServing,
        ingredient: {
          id: comp.ingredient.id,
          name: comp.ingredient.name,
          category: comp.ingredient.category,
          defaultUnit: comp.ingredient.defaultUnit,
          gramsPerPiece: comp.ingredient.gramsPerPiece,
        },
      })),
      nutrition: {
        calories: Math.round(nutrition.calories),
        protein: Math.round(nutrition.protein),
        carbs: Math.round(nutrition.carbs),
        fat: Math.round(nutrition.fat),
      },
      allergens,
    })
  } catch (error) {
    console.error('Failed to fetch meal:', error)
    return NextResponse.json({ error: 'Failed to fetch meal' }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

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

  const parsed = updateMealSchema.safeParse(body)

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors
    return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
  }

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  // Verify meal exists and belongs to this household
  const existingMeal = await prisma.meal.findFirst({
    where: {
      id,
      householdId: membership.household.id,
      deletedAt: null,
    },
  })

  if (!existingMeal) {
    return NextResponse.json({ error: 'Meal not found' }, { status: 404 })
  }

  const {
    name,
    description,
    preparationNotes,
    sourceUrl,
    timeMinutes,
    kidFriendly,
    suitableFor,
    servings,
    components,
  } = parsed.data

  // If components are being updated, verify all ingredients exist and recalculate protein type
  let primaryProteinType = existingMeal.primaryProteinType
  if (components && servings) {
    const ingredientIds = components.map((c) => c.ingredientId)
    const ingredients = await prisma.ingredient.findMany({
      where: { id: { in: ingredientIds } },
      select: {
        id: true,
        proteinType: true,
        protein: true,
      },
    })

    if (ingredients.length !== ingredientIds.length) {
      const foundIds = new Set(ingredients.map((i) => i.id))
      const missingIds = ingredientIds.filter((id) => !foundIds.has(id))
      return NextResponse.json({ error: 'Some ingredients not found', missingIds }, { status: 400 })
    }

    // Derive primary protein type from ingredients
    const ingredientMap = new Map(ingredients.map((i) => [i.id, i]))
    const componentData = components.map((c) => ({
      quantityPerServing: c.totalQuantity / servings,
      ingredient: ingredientMap.get(c.ingredientId)!,
    }))
    primaryProteinType = deriveProteinType(componentData)
  }

  // Build update data
  const updateData: {
    name?: string
    description?: string | null
    preparationNotes?: string | null
    sourceUrl?: string | null
    timeMinutes?: number | null
    kidFriendly?: boolean
    suitableFor?: ('breakfast' | 'lunch' | 'dinner')[]
    primaryProteinType?: typeof primaryProteinType
  } = {}

  if (name !== undefined) updateData.name = name
  if (description !== undefined) updateData.description = description
  if (preparationNotes !== undefined) updateData.preparationNotes = preparationNotes
  if (sourceUrl !== undefined) updateData.sourceUrl = sourceUrl
  if (timeMinutes !== undefined) updateData.timeMinutes = timeMinutes
  if (kidFriendly !== undefined) updateData.kidFriendly = kidFriendly
  if (suitableFor !== undefined) updateData.suitableFor = suitableFor
  if (components && servings) updateData.primaryProteinType = primaryProteinType

  // Use transaction to update meal and components atomically
  const meal = await prisma.$transaction(async (tx) => {
    // Update meal base fields
    await tx.meal.update({
      where: { id },
      data: updateData,
    })

    // Invalidate cached preparation tips when notes change
    if (preparationNotes !== undefined) {
      await tx.mealPlanEntry.updateMany({
        where: { mealId: id, preparationTips: { not: null } },
        data: { preparationTips: null },
      })
    }

    // If components are provided, delete old and create new
    if (components && servings) {
      await tx.mealComponent.deleteMany({
        where: { mealId: id },
      })

      await tx.mealComponent.createMany({
        data: components.map((c) => ({
          mealId: id,
          ingredientId: c.ingredientId,
          quantityPerServing: c.totalQuantity / servings,
        })),
      })
    }

    // Fetch updated meal with components
    return tx.meal.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        preparationNotes: true,
        sourceUrl: true,
        timeMinutes: true,
        kidFriendly: true,
        primaryProteinType: true,
        suitableFor: true,
        createdAt: true,
        updatedAt: true,
        components: {
          select: {
            ingredientId: true,
            quantityPerServing: true,
            ingredient: {
              select: {
                id: true,
                name: true,
                category: true,
                defaultUnit: true,
                gramsPerPiece: true,
                calories: true,
                protein: true,
                carbs: true,
                fat: true,
                allergens: true,
              },
            },
          },
        },
        favoritedBy: {
          where: { householdId: membership.household.id },
          select: { id: true },
        },
      },
    })
  })

  const nutrition = meal.components.reduce(
    (acc, comp) => {
      const factor = comp.quantityPerServing / 100
      return {
        calories: acc.calories + comp.ingredient.calories * factor,
        protein: acc.protein + comp.ingredient.protein * factor,
        carbs: acc.carbs + comp.ingredient.carbs * factor,
        fat: acc.fat + comp.ingredient.fat * factor,
      }
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  )

  const allergens = [...new Set(meal.components.flatMap((comp) => comp.ingredient.allergens))]

  return NextResponse.json({
    id: meal.id,
    name: meal.name,
    description: meal.description,
    preparationNotes: meal.preparationNotes,
    sourceUrl: meal.sourceUrl,
    timeMinutes: meal.timeMinutes,
    kidFriendly: meal.kidFriendly,
    primaryProteinType: meal.primaryProteinType,
    suitableFor: meal.suitableFor,
    isCustom: true,
    isFavorite: meal.favoritedBy.length > 0,
    createdAt: meal.createdAt,
    updatedAt: meal.updatedAt,
    components: meal.components.map((comp) => ({
      ingredientId: comp.ingredientId,
      quantityPerServing: comp.quantityPerServing,
      ingredient: {
        id: comp.ingredient.id,
        name: comp.ingredient.name,
        category: comp.ingredient.category,
        defaultUnit: comp.ingredient.defaultUnit,
        gramsPerPiece: comp.ingredient.gramsPerPiece,
      },
    })),
    nutrition: {
      calories: Math.round(nutrition.calories),
      protein: Math.round(nutrition.protein),
      carbs: Math.round(nutrition.carbs),
      fat: Math.round(nutrition.fat),
    },
    allergens,
  })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

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

  // Verify meal exists and belongs to this household
  const existingMeal = await prisma.meal.findFirst({
    where: {
      id,
      householdId: membership.household.id,
      deletedAt: null,
    },
  })

  if (!existingMeal) {
    return NextResponse.json({ error: 'Meal not found' }, { status: 404 })
  }

  // Soft delete - set deletedAt timestamp
  await prisma.meal.update({
    where: { id },
    data: { deletedAt: new Date() },
  })

  return NextResponse.json({ success: true })
}
