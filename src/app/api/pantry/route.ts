import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'

const createPantryItemSchema = z.object({
  ingredientId: z.string().min(1),
  quantity: z.number().nullable().optional(),
  isStaple: z.boolean().optional().default(false),
})

export async function GET() {
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

  const pantryItems = await prisma.pantryItem.findMany({
    where: { householdId: membership.householdId },
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
    orderBy: [{ isStaple: 'desc' }, { ingredient: { name: 'asc' } }],
  })

  const items = pantryItems.map((item) => ({
    id: item.id,
    ingredientId: item.ingredientId,
    ingredient: item.ingredient,
    quantity: item.quantity,
    isStaple: item.isStaple,
    updatedAt: item.updatedAt,
  }))

  return NextResponse.json({ items })
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
