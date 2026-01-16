import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'

const updatePreferencesSchema = z.object({
  displayName: z
    .string()
    .max(50)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  portionMultiplier: z.number().min(0.5).max(3.0).optional(),
  targetCalories: z.number().int().min(500).max(5000).nullable().optional(),
  targetProtein: z.number().int().min(0).max(500).nullable().optional(),
  targetCarbs: z.number().int().min(0).max(500).nullable().optional(),
  targetFat: z.number().int().min(0).max(500).nullable().optional(),
  dietaryType: z.enum(['omnivore', 'vegetarian', 'vegan', 'pescatarian']).nullable().optional(),
  restrictions: z.array(z.string()).optional(),
  excludedIngredients: z.array(z.string()).optional(),
  excludedIngredientIds: z.array(z.string()).optional(),
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

  // Get or create member preferences
  let preferences = await prisma.memberPreferences.findUnique({
    where: { memberId: membership.id },
  })

  if (!preferences) {
    preferences = await prisma.memberPreferences.create({
      data: { memberId: membership.id },
    })
  }

  return NextResponse.json(preferences)
}

export async function PATCH(request: Request) {
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

  const parsed = updatePreferencesSchema.safeParse(body)

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors
    return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
  }

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const preferences = await prisma.memberPreferences.upsert({
    where: { memberId: membership.id },
    create: {
      memberId: membership.id,
      ...parsed.data,
    },
    update: parsed.data,
  })

  return NextResponse.json(preferences)
}
