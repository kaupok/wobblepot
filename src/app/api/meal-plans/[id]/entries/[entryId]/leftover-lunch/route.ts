import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { EntryCreateError } from '@/lib/meal-plans/create-entry'
import { leftoverServingsSchema } from '@/lib/meal-plans/fridge-items'
import { SetFridgeItemsError } from '@/lib/meal-plans/fridge-meal'
import { addLeftoverLunch, LeftoverLunchError } from '@/lib/meal-plans/leftover-lunch'

const bodySchema = z.object({ servings: leftoverServingsSchema }).strict()

/**
 * POST /api/meal-plans/[id]/entries/[entryId]/leftover-lunch
 *
 * "Cook for tomorrow's lunch too" on a planned recipe dinner (HON-1396): one
 * leftover item for this dinner, at `servings`, on the next day's lunch. The
 * rules live in `addLeftoverLunch`. A refusal answers 409 with the reason as
 * `code`, so the client words it from the catalog.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const membership = await getHouseholdMembership(session.user.id)
  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors
    return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
  }

  const { household } = membership
  const { id: planId, entryId } = await params
  try {
    return NextResponse.json(
      await addLeftoverLunch(household, planId, entryId, parsed.data.servings),
    )
  } catch (error) {
    if (error instanceof LeftoverLunchError) {
      return error.reason === 'dinnerNotFound'
        ? NextResponse.json({ error: 'Entry not found or access denied' }, { status: 404 })
        : NextResponse.json(
            { error: `Leftover lunch refused: ${error.reason}`, code: error.reason },
            { status: 409 },
          )
    }
    // The lunch changed between the read and the write.
    if (error instanceof EntryCreateError || error instanceof SetFridgeItemsError) {
      return NextResponse.json(
        { error: 'The lunch changed meanwhile', code: 'lunchChanged' },
        { status: 409 },
      )
    }
    captureApiError(error, {
      route: '/api/meal-plans/[id]/entries/[entryId]/leftover-lunch',
      userId: session.user.id,
      householdId: household.id,
    })
    return NextResponse.json({ error: 'Failed to plan the leftover lunch' }, { status: 500 })
  }
}
