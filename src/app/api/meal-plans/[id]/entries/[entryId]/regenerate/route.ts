import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { suggestForSlot } from '@/lib/meal-planning/slot-suggestions'
import { loadSlotEntry } from '@/lib/meal-plans/slot-context'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'
import { AiCostCapExceededError, assertUnderCap, respondCapExceeded } from '@/lib/ai/usage'
import { withRequestId } from '@/lib/request-id'
import { captureApiError } from '@/lib/errors'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'

/**
 * POST /api/meal-plans/[id]/entries/[entryId]/regenerate
 *
 * Ranked alternatives for an entry with a meal, the current meal left out.
 * The ranking lives in `suggestForSlot` (`swap` mode), which the MCP
 * `swap_meal` tool shares (HON-1174).
 */
async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  // Auth check
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get household membership with preferences
  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const { household } = membership
  // Resolved once: a locale rolled back out of KNOWN_LOCALES reads as English
  // for content and the AI prompt alike (HON-921).
  const locale = resolveHouseholdLocale(household)

  // Extract params
  const { id: planId, entryId } = await params

  // Shares the `meal-suggestions` bucket (60/h per household) with the sibling
  // `/suggestions` route rather than getting its own: swapping a meal and filling
  // an empty slot are one activity in the same modal, and the two routes do the
  // same scoring pass, so they share one ceiling (HON-710). Runs before
  // `assertUnderCap` so a rejected request does no DB work.
  const rateLimitResult = await checkRateLimit(household.id, 'meal-suggestions')
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        message: `Maximum ${rateLimitResult.limit} suggestion requests per hour`,
        resetAt: rateLimitResult.resetAt.toISOString(),
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds(rateLimitResult)) },
      },
    )
  }

  try {
    await assertUnderCap(household.id)
  } catch (error) {
    if (error instanceof AiCostCapExceededError) {
      return respondCapExceeded(error)
    }
    throw error
  }

  try {
    // Scoped to the plan and to the user's household, so another household's
    // entry reads as missing.
    const entry = await loadSlotEntry(household.id, planId, entryId)

    if (!entry) {
      return NextResponse.json({ error: 'Entry not found or access denied' }, { status: 404 })
    }

    const alternatives = await suggestForSlot(household, entry, 'swap', locale)

    // No suggestions available. The code tells this 404 from a missing entry,
    // so "Pick for me" can say no meal fits (HON-1249).
    if (alternatives.length === 0) {
      return NextResponse.json(
        {
          error: 'No alternative meals available matching your preferences',
          code: 'no_suggestions',
        },
        { status: 404 },
      )
    }

    return NextResponse.json({ alternatives }, { status: 200 })
  } catch (error) {
    captureApiError(error, {
      route: '/api/meal-plans/[id]/entries/[entryId]/regenerate',
      userId: session.user.id,
      feature: 'meal_regenerate',
    })
    return NextResponse.json({ error: 'Failed to generate alternatives' }, { status: 500 })
  }
}

export const POST = withRequestId(handlePOST)
