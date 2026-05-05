import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { serverEnv } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import { MealType } from '@/generated/prisma/enums'
import { resolveLocale } from '@/lib/i18n/resolve-locale'
import { DEFAULT_LOCALE, isEffectivelyPublicLocale } from '@/lib/i18n/locales'

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
  const requestHeaders = await headers()
  const session = await auth.api.getSession({
    headers: requestHeaders,
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

  // Onboarding has no household yet — resolver falls through to Accept-Language.
  // Persisting the result here prevents the chrome locale from snapping back to
  // English the moment the household row exists. Clamped to PUBLIC_LOCALES so a
  // non-English browser doesn't silently land a general user on a locale whose
  // public enablement conditions (e.g. email-template localization) haven't
  // cleared yet; partner households opt into non-public locales via direct DB
  // write, which bypasses this path. The clamp is a no-op once PUBLIC_LOCALES
  // widens to the full KNOWN_LOCALES set. `FEATURE_PUBLIC_LOCALES_FULL` widens
  // the effective set per-environment for staging dogfooding (HON-544).
  const fullPublicEnabled =
    serverEnv.FEATURE_PUBLIC_LOCALES_FULL === '1' ||
    serverEnv.FEATURE_PUBLIC_LOCALES_FULL === 'true'
  const resolved = resolveLocale({
    householdLocale: null,
    acceptLanguage: requestHeaders.get('accept-language'),
  })
  const locale = isEffectivelyPublicLocale(resolved, fullPublicEnabled) ? resolved : DEFAULT_LOCALE

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
          locale,
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
        locale: household!.locale,
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
