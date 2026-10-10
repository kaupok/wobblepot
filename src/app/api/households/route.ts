import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { Allergen, MealType } from '@/generated/prisma/enums'
import { resolveLocale } from '@/lib/i18n/resolve-locale'
import { isMembershipConflict, runHouseholdClaim } from '@/lib/household-claim'
import { captureApiError } from '@/lib/errors'
import { shouldSkipLocalCapture } from '@/lib/release'
import { seedDefaultStaples } from '@/lib/meal-planning/default-staples'
import { PORTION_BY_TYPE } from '@/lib/meal-planning/servings'

/**
 * Upper bound on the `members` array, which is the *additional* members beyond
 * the owner. Each one costs two writes (`householdMember` + `memberPreferences`)
 * inside the claim transaction, and `runHouseholdClaim` may re-run that loop
 * once per retry — so an unbounded array is an unbounded transaction, paid up
 * to `MAX_CLAIM_ATTEMPTS` times.
 *
 * 20 is well clear of anything a legitimate client sends: `OnboardingFlow`
 * stops its Add buttons at a household of 10 (`MAX_MEMBERS`), so the
 * onboarding screen can produce at most 9. It is generous for the family
 * household the product targets while still bounding the write.
 */
const MAX_ADDITIONAL_MEMBERS = 20

const createHouseholdSchema = z.object({
  name: z.string().min(1).max(100),
  members: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        portionType: z.enum(['adult', 'child']).default('adult'),
      }),
    )
    .max(MAX_ADDITIONAL_MEMBERS)
    .optional(),
  // Asked in onboarding step 3, so the first plan already avoids them (HON-1082).
  // Nine values exist, so a longer array can only hold duplicates.
  allergensToAvoid: z.array(z.enum(Allergen)).max(Object.keys(Allergen).length).optional(),
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
    const allergensToAvoid = [...new Set(parsed.data.allergensToAvoid ?? [])]

    // `runHouseholdClaim`, not a bare `$transaction`: sharing a transaction is
    // not enough on its own. At read committed this check is a `SELECT`
    // matching zero rows, so it takes no lock, and two concurrent creates for
    // the same user insert two *different* member rows — `@@unique([householdId,
    // userId])` never fires because the household ids differ. A double submit
    // is enough to trigger it (HON-679). The helper holds this user's row lock
    // for the whole claim, so the second create waits, then sees the first's
    // membership here and resolves to the `already_in_household` 400 below.
    // Creates by different users take different locks and never wait on each
    // other (HON-838).
    //
    // Since HON-696 a unique index on `household_member."userId"` enforces the
    // invariant on its own; a loser that the index rejects surfaces as `P2002`
    // — mapped to the same 400 below.
    const household = await runHouseholdClaim(session.user.id, async (tx) => {
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
          allergensToAvoid,
        },
      })

      // Salt, black pepper and water start as staples so "to taste" seasonings
      // stay off the shopping list (HON-769). The seed's smoke household calls this too.
      await seedDefaultStaples(tx, newHousehold.id)

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
              portionMultiplier: PORTION_BY_TYPE[member.portionType],
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
    // `isMembershipConflict`: the unique index on `household_member."userId"`
    // rejected the owner row — a concurrent create or join committed a
    // membership for this user first (HON-696). Same answer as the pre-check,
    // because `OnboardingFlow` branches on this exact `error` string.
    if (
      (error instanceof Error && error.message === 'already_in_household') ||
      isMembershipConflict(error)
    ) {
      return NextResponse.json(
        {
          error: 'already_in_household',
          message: 'You are already a member of a household.',
        },
        { status: 400 },
      )
    }

    // Answer in JSON rather than rethrowing. A rethrow is rendered by Next as
    // an HTML error page, which reaches `OnboardingFlow` with no `error`
    // or `message` to branch on, and nothing is reported.
    // `runHouseholdClaim` makes this reachable for a persistent `P2034`, but
    // any unexpected database error lands here the same way.
    captureApiError(error, { route: '/api/households', userId: session.user.id })
    // `captureApiError` drops everything on a local machine, which left a
    // failed onboarding create with no trace at all on a dev server or a local
    // E2E run (HON-838). Deployed environments still report only to PostHog.
    if (shouldSkipLocalCapture()) {
      // eslint-disable-next-line no-console
      console.error('[api/households] Failed to create household:', error)
    }
    return NextResponse.json({ error: 'Failed to create household' }, { status: 500 })
  }
}
