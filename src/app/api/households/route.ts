import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const createHouseholdSchema = z.object({
  name: z.string().min(1).max(100),
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

  // Create household, membership, and preferences in a transaction
  try {
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
          name: parsed.data.name,
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
          // Uses schema defaults: weekdayMealTypes: [dinner], weekendMealTypes: [dinner]
        },
      })

      return tx.household.findUnique({
        where: { id: newHousehold.id },
        include: { preferences: true },
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
