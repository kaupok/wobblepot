import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'
import { KNOWN_LOCALES } from '@/lib/i18n/locales'
import { captureApiError } from '@/lib/errors'

const updateHouseholdSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  timezone: z
    .string()
    .refine((tz) => Intl.supportedValuesOf('timeZone').includes(tz), {
      message: 'Invalid timezone',
    })
    .optional(),
  locale: z.enum(KNOWN_LOCALES).optional(),
})

export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const householdMembership = await getHouseholdMembership(session.user.id)

    if (!householdMembership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    const { household } = householdMembership
    return NextResponse.json({
      id: household.id,
      name: household.name,
      timezone: household.timezone,
      locale: household.locale,
      createdAt: household.createdAt,
      preferences: household.preferences,
    })
  } catch (error) {
    captureApiError(error, { route: '/api/households/me', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to fetch household' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = updateHouseholdSchema.safeParse(body)

    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
    }

    const membership = await getHouseholdMembership(session.user.id)

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    if (membership.role !== 'owner') {
      return NextResponse.json(
        { error: 'forbidden', message: 'Only the household owner can edit these settings.' },
        { status: 403 },
      )
    }

    const household = await prisma.household.update({
      where: { id: membership.household.id },
      data: parsed.data,
      include: { preferences: true },
    })

    return NextResponse.json({
      id: household.id,
      name: household.name,
      timezone: household.timezone,
      locale: household.locale,
      createdAt: household.createdAt,
      preferences: household.preferences,
    })
  } catch (error) {
    captureApiError(error, { route: '/api/households/me', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to update household' }, { status: 500 })
  }
}
