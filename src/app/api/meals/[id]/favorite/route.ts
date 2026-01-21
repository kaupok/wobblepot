import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: mealId } = await params

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

  // Verify meal exists
  const meal = await prisma.meal.findFirst({
    where: {
      id: mealId,
      deletedAt: null,
      // Meal can be either a system meal (householdId: null) or custom meal from this household
      OR: [{ householdId: null }, { householdId: membership.household.id }],
    },
  })

  if (!meal) {
    return NextResponse.json({ error: 'Meal not found' }, { status: 404 })
  }

  // Check if already favorited
  const existing = await prisma.favoriteMeal.findUnique({
    where: {
      householdId_mealId: {
        householdId: membership.household.id,
        mealId,
      },
    },
  })

  if (existing) {
    return NextResponse.json({ error: 'Meal is already favorited' }, { status: 409 })
  }

  // Create favorite
  const favorite = await prisma.favoriteMeal.create({
    data: {
      householdId: membership.household.id,
      mealId,
    },
  })

  return NextResponse.json({ id: favorite.id, mealId, isFavorite: true }, { status: 201 })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: mealId } = await params

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

  // Delete the favorite if it exists
  const deleted = await prisma.favoriteMeal.deleteMany({
    where: {
      householdId: membership.household.id,
      mealId,
    },
  })

  if (deleted.count === 0) {
    return NextResponse.json({ error: 'Favorite not found' }, { status: 404 })
  }

  return NextResponse.json({ mealId, isFavorite: false })
}
