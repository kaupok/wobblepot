import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'

const unpurchaseSchema = z.object({
  ingredientId: z.string().min(1),
})

const UNPURCHASE_WINDOW_DAYS = 7

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const parsed = unpurchaseSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const { ingredientId } = parsed.data

  // Find the pantry item
  const pantryItem = await prisma.pantryItem.findUnique({
    where: {
      householdId_ingredientId: {
        householdId: household.id,
        ingredientId,
      },
    },
    select: {
      id: true,
      isStaple: true,
      updatedAt: true,
    },
  })

  if (!pantryItem) {
    return NextResponse.json({ error: 'Item not found in pantry' }, { status: 404 })
  }

  // Check if item is a staple
  if (pantryItem.isStaple) {
    return NextResponse.json(
      { error: 'Cannot unpurchase staple items', reason: 'staple' },
      { status: 400 },
    )
  }

  // Check if item was added within the unpurchase window
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - UNPURCHASE_WINDOW_DAYS)

  if (pantryItem.updatedAt < cutoffDate) {
    return NextResponse.json(
      {
        error: 'Cannot unpurchase items added more than 7 days ago',
        reason: 'too_old',
      },
      { status: 400 },
    )
  }

  // Delete the pantry item
  await prisma.pantryItem.delete({
    where: { id: pantryItem.id },
  })

  return NextResponse.json(
    {
      success: true,
      ingredientId,
      action: 'removed',
    },
    { status: 200 },
  )
}
