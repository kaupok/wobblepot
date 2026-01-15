import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'

const updateMemberSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  preferences: z
    .object({
      displayName: z.string().min(1).max(50).optional(),
      portionMultiplier: z.number().min(0.5).max(3.0).optional(),
      dietaryType: z.enum(['omnivore', 'vegetarian', 'vegan', 'pescatarian']).nullable().optional(),
      allergens: z
        .array(
          z.enum([
            'gluten',
            'dairy',
            'eggs',
            'nuts',
            'peanuts',
            'soy',
            'fish',
            'shellfish',
            'sesame',
          ]),
        )
        .optional(),
      restrictions: z.array(z.string()).optional(),
      excludedIngredients: z.array(z.string()).optional(),
      excludedIngredientIds: z.array(z.string()).optional(),
    })
    .optional(),
})

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: memberId } = await params

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const householdMembership = await getHouseholdMembership(session.user.id)

  if (!householdMembership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const member = await prisma.householdMember.findUnique({
    where: { id: memberId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
      preferences: true,
    },
  })

  if (!member || member.householdId !== householdMembership.householdId) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  return NextResponse.json({
    id: member.id,
    userId: member.userId,
    name: member.name,
    role: member.role,
    joinedAt: member.joinedAt,
    user: member.user,
    preferences: member.preferences
      ? {
          displayName: member.preferences.displayName,
          portionMultiplier: member.preferences.portionMultiplier,
          dietaryType: member.preferences.dietaryType,
          allergens: member.preferences.allergens,
          restrictions: member.preferences.restrictions,
        }
      : null,
  })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: memberId } = await params

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const householdMembership = await getHouseholdMembership(session.user.id)

  if (!householdMembership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  // Only owners can update members
  if (householdMembership.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only the household owner can update members' },
      { status: 403 },
    )
  }

  const member = await prisma.householdMember.findUnique({
    where: { id: memberId },
  })

  if (!member || member.householdId !== householdMembership.householdId) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = updateMemberSchema.safeParse(body)

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors
    return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
  }

  const { name, preferences } = parsed.data

  // Only allow updating name for manual members (those without userId)
  if (name !== undefined && member.userId !== null) {
    return NextResponse.json({ error: 'Cannot update name for linked members' }, { status: 400 })
  }

  const updatedMember = await prisma.$transaction(async (tx) => {
    // Update member name if provided and it's a manual member
    if (name !== undefined) {
      await tx.householdMember.update({
        where: { id: memberId },
        data: { name },
      })
    }

    // Update preferences if provided
    if (preferences) {
      await tx.memberPreferences.upsert({
        where: { memberId },
        create: {
          memberId,
          displayName: preferences.displayName,
          portionMultiplier: preferences.portionMultiplier,
          dietaryType: preferences.dietaryType,
          allergens: preferences.allergens,
          restrictions: preferences.restrictions,
          excludedIngredients: preferences.excludedIngredients,
          excludedIngredientIds: preferences.excludedIngredientIds,
        },
        update: {
          displayName: preferences.displayName,
          portionMultiplier: preferences.portionMultiplier,
          dietaryType: preferences.dietaryType,
          allergens: preferences.allergens,
          restrictions: preferences.restrictions,
          excludedIngredients: preferences.excludedIngredients,
          excludedIngredientIds: preferences.excludedIngredientIds,
        },
      })
    }

    return tx.householdMember.findUnique({
      where: { id: memberId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
        preferences: true,
      },
    })
  })

  return NextResponse.json({
    id: updatedMember!.id,
    userId: updatedMember!.userId,
    name: updatedMember!.name,
    role: updatedMember!.role,
    joinedAt: updatedMember!.joinedAt,
    user: updatedMember!.user,
    preferences: updatedMember!.preferences
      ? {
          displayName: updatedMember!.preferences.displayName,
          portionMultiplier: updatedMember!.preferences.portionMultiplier,
          dietaryType: updatedMember!.preferences.dietaryType,
          allergens: updatedMember!.preferences.allergens,
          restrictions: updatedMember!.preferences.restrictions,
        }
      : null,
  })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: memberId } = await params

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const householdMembership = await getHouseholdMembership(session.user.id)

  if (!householdMembership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  // Only owners can delete members
  if (householdMembership.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only the household owner can remove members' },
      { status: 403 },
    )
  }

  const member = await prisma.householdMember.findUnique({
    where: { id: memberId },
  })

  if (!member || member.householdId !== householdMembership.householdId) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  // Prevent owner from deleting themselves
  if (member.userId === session.user.id) {
    return NextResponse.json(
      { error: 'Cannot remove yourself from the household' },
      { status: 400 },
    )
  }

  // Prevent deleting the owner
  if (member.role === 'owner') {
    return NextResponse.json({ error: 'Cannot remove the household owner' }, { status: 400 })
  }

  await prisma.householdMember.delete({
    where: { id: memberId },
  })

  return NextResponse.json({ success: true })
}
