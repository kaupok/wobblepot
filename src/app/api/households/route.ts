import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MealType } from '@/generated/prisma/enums'

const createHouseholdSchema = z.object({
  name: z.string().min(1).max(100),
  members: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        portionType: z.enum(['adult', 'child']).default('adult'),
      }),
    )
    .optional(),
})

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

  const parsed = createHouseholdSchema.safeParse(body)

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors
    return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
  }

  // Create household, membership, preferences, and optional members in a transaction
  try {
    const { name, members } = parsed.data

    const household = await prisma.$transaction(async (tx) => {
      // Check inside transaction to prevent race condition
      const existingMembership = await tx.householdMember.findFirst({
        where: { userId: session.user.id },
      })

      if (existingMembership) {
        throw new Error('already_in_household')
      }

      const newHousehold = await tx.household.create({
        data: {
          name,
        },
      })

      await tx.householdMember.create({
        data: {
          householdId: newHousehold.id,
          userId: session.user.id,
          role: 'owner',
        },
      })

      await tx.householdPreferences.create({
        data: {
          householdId: newHousehold.id,
          weekdayMealTypes: [MealType.dinner],
          weekendMealTypes: [MealType.dinner],
        },
      })

      // Create any additional household members with portion preferences
      if (members && members.length > 0) {
        for (const member of members) {
          const newMember = await tx.householdMember.create({
            data: {
              householdId: newHousehold.id,
              name: member.name,
              role: 'member',
            },
          })

          await tx.memberPreferences.create({
            data: {
              memberId: newMember.id,
              portionMultiplier: member.portionType === 'child' ? 0.5 : 1.0,
            },
          })
        }
      }

      return tx.household.findUnique({
        where: { id: newHousehold.id },
        include: { preferences: true, members: true },
      })
    })

    return NextResponse.json(
      {
        id: household!.id,
        name: household!.name,
        timezone: household!.timezone,
        createdAt: household!.createdAt,
        preferences: household!.preferences,
      },
      { status: 201 },
    )
  } catch (error) {
    if (error instanceof Error && error.message === 'already_in_household') {
      return NextResponse.json(
        {
          error: 'already_in_household',
          message: 'You are already a member of a household.',
        },
        { status: 400 },
      )
    }
    throw error
  }
}
