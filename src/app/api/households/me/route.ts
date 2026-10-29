import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership, updateHousehold } from '@/lib/household'
import { LocaleSchema } from '@/lib/i18n/locales'

const updateHouseholdSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  timezone: z
    .string()
    .refine((tz) => Intl.supportedValuesOf('timeZone').includes(tz), {
      message: 'Invalid timezone',
    })
    .optional(),
  locale: LocaleSchema.optional(),
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

    // Clears the cached prep tips when the locale moves (HON-681).
    const household = await updateHousehold(membership.household, parsed.data)

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
