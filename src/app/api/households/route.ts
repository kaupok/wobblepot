import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MealType } from '@/generated/prisma/enums'
import { resolveLocale } from '@/lib/i18n/resolve-locale'
import { runHouseholdClaim } from '@/lib/household-claim'

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
  // English the moment the household row exists. `resolveLocale` guarantees the
  // return value is in `KNOWN_LOCALES`, which equals `PUBLIC_LOCALES` today
  // (HON-549), so no clamp is needed.
  const locale = resolveLocale({
    householdLocale: null,
    acceptLanguage: requestHeaders.get('accept-language'),
  })

  // Create household, membership, preferences, and optional members in a transaction
  try {
    const { name, members } = parsed.data

    // `runHouseholdClaim`, not a bare `$transaction`: sharing a transaction is
    // not enough on its own. At read committed this check is a `SELECT`
    // matching zero rows, so it takes no lock, and two concurrent creates for
    // the same user insert two *different* member rows — `@@unique([householdId,
    // userId])` never fires because the household ids differ. A double submit
    // is enough to trigger it. The helper runs this at `Serializable`, where
    // SSI's predicate locks catch the write skew, and retries the loser's
    // `P2034` so it resolves to the `already_in_household` 400 below (HON-679).
    //
    // Both membership-creating routes must use it: PostgreSQL only registers
    // the conflict when the *writing* transaction is also serializable, so a
    // serializable invite join racing a read-committed create here would still
    // commit twice.
    const household = await runHouseholdClaim(async (tx) => {
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

      // This route is the only household creator, so it must stay the one that
      // writes the preferences row (the seed's smoke household is the exception; HON-672).
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
