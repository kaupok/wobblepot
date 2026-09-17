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

    const updateArgs = {
      where: { id: membership.household.id },
      data: parsed.data,
      include: { preferences: true },
    }

    // The household's locale is an input to every cached prep-tips generation
    // (`MealPlanEntry.preparationTips`), and `docs/LOCALIZATION.md` requires AI
    // caches not to survive a locale change. Nothing else clears them, and
    // three read sites serialise the stored value straight into the entry
    // payload — so a household that switches en → et would keep showing
    // English tips indefinitely. Drop them here and let the next open of the
    // modal regenerate through the existing rate-limited path (HON-681).
    //
    // Only when the locale actually moves: a name-only or timezone-only PATCH,
    // or one that resends the stored locale, must not touch a single entry.
    const localeChanged =
      parsed.data.locale !== undefined && parsed.data.locale !== membership.household.locale

    const household = localeChanged
      ? await prisma.$transaction(async (tx) => {
          const updated = await tx.household.update(updateArgs)

          await tx.mealPlanEntry.updateMany({
            where: {
              plan: { householdId: membership.household.id },
              preparationTips: { not: null },
            },
            data: { preparationTips: null },
          })

          return updated
        })
      : await prisma.household.update(updateArgs)

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
