import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth, createHouseholdForUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const updatePreferencesSchema = z.object({
  dietaryType: z
    .enum(['omnivore', 'vegetarian', 'vegan', 'pescatarian'])
    .nullable()
    .optional(),
  allergensToAvoid: z
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
      ])
    )
    .optional(),
  restrictions: z.array(z.string()).optional(),
  excludedIngredients: z.array(z.string()).optional(),
  excludedIngredientIds: z.array(z.string()).optional(),
  weekdayMealTypes: z
    .array(z.enum(['breakfast', 'lunch', 'dinner']))
    .optional(),
  weekendMealTypes: z
    .array(z.enum(['breakfast', 'lunch', 'dinner']))
    .optional(),
})

async function getHouseholdMembership(userId: string) {
  let membership = await prisma.householdMember.findFirst({
    where: { userId },
    include: {
      household: {
        include: { preferences: true },
      },
    },
  })

  // Self-healing: create household if none exists (handles legacy users)
  if (!membership) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    })
    await createHouseholdForUser(userId, user?.name ?? 'User')
    membership = await prisma.householdMember.findFirst({
      where: { userId },
      include: {
        household: {
          include: { preferences: true },
        },
      },
    })
  }

  return membership
}

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

  return NextResponse.json(membership.household.preferences)
}

export async function PATCH(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const parsed = updatePreferencesSchema.safeParse(body)

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors
    return NextResponse.json(
      { error: 'Validation failed', details: errors },
      { status: 400 }
    )
  }

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const preferences = await prisma.householdPreferences.update({
    where: { householdId: membership.household.id },
    data: parsed.data,
  })

  return NextResponse.json(preferences)
}
