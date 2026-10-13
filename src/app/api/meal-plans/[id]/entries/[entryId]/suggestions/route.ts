import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { suggestForSlot } from '@/lib/meal-planning/slot-suggestions'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'
import { AiCostCapExceededError, assertUnderCap, respondCapExceeded } from '@/lib/ai/usage'
import { withRequestId } from '@/lib/request-id'
import { captureApiError } from '@/lib/errors'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'

/**
 * POST /api/meal-plans/[id]/entries/[entryId]/suggestions
 *
 * Generate AI suggestions for an empty slot based on slot context (meal type + day).
 * Similar to /regenerate but designed for adding meals to empty slots. The
 * ranking lives in `suggestForSlot` (`add` mode), which the MCP `swap_meal` tool
 * shares (HON-1174).
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
    // Fetch entry with plan details
    const entry = await prisma.mealPlanEntry.findFirst({
      where: {
        id: entryId,
        planId: planId,
        plan: {
          householdId: household.id,
        },
      },
      include: {
        plan: true,
      },
    })

    if (!entry) {
      return NextResponse.json({ error: 'Entry not found or access denied' }, { status: 404 })
    }

    const alternatives = await suggestForSlot(household, entry, 'add', locale)

    // No suggestions available
    if (alternatives.length === 0) {
      return NextResponse.json(
        { error: 'No meals available matching your preferences' },
        { status: 404 },
      )
    }

    return NextResponse.json({ alternatives }, { status: 200 })
  } catch (error) {
    captureApiError(error, {
      route: '/api/meal-plans/[id]/entries/[entryId]/suggestions',
      userId: session.user.id,
      feature: 'meal_suggestions',
    })
    return NextResponse.json({ error: 'Failed to generate suggestions' }, { status: 500 })
  }
}

export const POST = withRequestId(handlePOST)
