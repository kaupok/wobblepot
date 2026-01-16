import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'

const createManualMemberSchema = z.object({
  name: z.string().min(1).max(100),
  preferences: z
    .object({
      displayName: z.string().max(50).nullable().optional(),
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

export async function GET() {
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

  const members = await prisma.householdMember.findMany({
    where: { householdId: householdMembership.householdId },
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
    orderBy: { joinedAt: 'asc' },
  })

  return NextResponse.json({
    householdId: householdMembership.householdId,
    members: members.map((member) => ({
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
    })),
  })
}

export async function POST(request: Request) {
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

  // Only owners can add manual members
  if (householdMembership.role !== 'owner') {
    return NextResponse.json({ error: 'Only the household owner can add members' }, { status: 403 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = createManualMemberSchema.safeParse(body)

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors
    return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
  }

  const { name, preferences } = parsed.data

  // Create the manual member with preferences in a transaction
  const member = await prisma.$transaction(async (tx) => {
    const newMember = await tx.householdMember.create({
      data: {
        householdId: householdMembership.householdId,
        name,
        role: 'member', // Manual members are always regular members
      },
    })

    if (preferences) {
      await tx.memberPreferences.create({
        data: {
          memberId: newMember.id,
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
      where: { id: newMember.id },
      include: {
        preferences: true,
      },
    })
  })

  return NextResponse.json(
    {
      id: member!.id,
      userId: member!.userId,
      name: member!.name,
      role: member!.role,
      joinedAt: member!.joinedAt,
      user: null,
      preferences: member!.preferences
        ? {
            displayName: member!.preferences.displayName,
            portionMultiplier: member!.preferences.portionMultiplier,
            dietaryType: member!.preferences.dietaryType,
            allergens: member!.preferences.allergens,
            restrictions: member!.preferences.restrictions,
          }
        : null,
    },
    { status: 201 },
  )
}
