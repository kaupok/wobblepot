import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { Allergen } from '@/generated/prisma/enums'
import { resolveLocale } from '@/lib/i18n/resolve-locale'
import {
  AlreadyInHouseholdError,
  createHousehold,
  isMembershipConflict,
} from '@/lib/household-claim'
import { captureApiError } from '@/lib/errors'
import { shouldSkipLocalCapture } from '@/lib/release'

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

  try {
    // Under the user's row lock, so a double submit cannot create two
    // households (HON-679, HON-838).
    const household = await createHousehold(session.user.id, { ...parsed.data, locale })

    return NextResponse.json(
      {
        id: household.id,
        name: household.name,
        timezone: household.timezone,
        locale: household.locale,
        createdAt: household.createdAt,
        preferences: household.preferences,
      },
      { status: 201 },
    )
  } catch (error) {
    // `isMembershipConflict`: the unique index on `household_member."userId"`
    // rejected the owner row — a concurrent create or join committed a
    // membership for this user first (HON-696). Same answer as the pre-check,
    // because `OnboardingFlow` branches on this exact `error` string.
    if (error instanceof AlreadyInHouseholdError || isMembershipConflict(error)) {
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
