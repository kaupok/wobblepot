import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { AiCostCapExceededError, assertUnderCap, respondCapExceeded } from '@/lib/ai/usage'
import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { getTodayInTimezone, parseLocalDate } from '@/lib/meal-planning/dates'
import {
  createEntry,
  EntryCreateError,
  type EntryCreateRefusal,
} from '@/lib/meal-plans/create-entry'
import { deleteEntriesInRange } from '@/lib/meal-plans/entries'
import { fridgeItemsSchema } from '@/lib/meal-plans/fridge-items'
import { FridgeItemNotFoundError } from '@/lib/meal-plans/fridge-meal'
import { NoSuggestionsError, pickMealForSlot } from '@/lib/meal-plans/pick-for-slot'
import { CHANGED_SOURCE_PROBLEMS, findLeftoverSourceProblem } from '@/lib/meal-plans/recent-meals'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'

/** One axis of the note's place on the card: a fraction of its room (`NotePosition`), or null for the default. */
const notePositionAxis = z.number().min(0).max(1).nullable().optional()

// The fields past `note` are for Undo after Clear, which posts the cleared
// entry back (HON-1123). A completed entry offers no Clear, so a restore
// never sends `completed`. The one completed create is a log on Past meals
// (HON-1383): a meal the household already ate, on a day before its today.
// The pantry is never charged for it: the server saves it as already charged
// (HON-1391), so the client sends no `pantryDeducted`, and the POST refuses
// `completed` for today or a later day. `pick` is "Pick for
// me": the server places the slot's top suggestion itself, so it names no
// meal (HON-1248). `fridgeItems` makes a fridge meal, which has no meal
// either (HON-1277).
const createEntrySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    mealType: z.enum(['breakfast', 'lunch', 'dinner']),
    mealId: z.string().optional(),
    fridgeItems: fridgeItemsSchema.optional(),
    note: z.string().max(200).nullable().optional(),
    noteX: notePositionAxis,
    noteY: notePositionAxis,
    status: z.enum(['planned', 'skipped', 'completed']).optional(),
    servingOverride: z.number().int().min(1).max(20).nullable().optional(),
    rating: z.enum(['up', 'down']).nullable().optional(),
    pantryDeducted: z.boolean().optional(),
    pick: z.literal('suggested').optional(),
    // Undo after Clear (HON-1396): the entry's own items come back, so the
    // leftover source rule passes what a source changed since can cause.
    restore: z.literal(true).optional(),
  })
  // The note's place is one point, set together, and only beside a note
  // (HON-975).
  .superRefine((data, ctx) => {
    if ((data.noteX == null) !== (data.noteY == null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['noteX'],
        message: 'noteX and noteY are set together',
      })
    }
    if (!data.note && data.noteX != null) {
      ctx.addIssue({ code: 'custom', path: ['noteX'], message: 'A position needs a note' })
    }
    if (data.pick && data.mealId) {
      ctx.addIssue({
        code: 'custom',
        path: ['pick'],
        message: 'pick and mealId exclude each other',
      })
    }
    if (data.fridgeItems && (data.mealId || data.pick)) {
      ctx.addIssue({
        code: 'custom',
        path: ['fridgeItems'],
        message: 'fridgeItems excludes mealId and pick',
      })
    }
    if (data.status === 'completed' && (data.pick || data.pantryDeducted)) {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'A completed log excludes pick and pantryDeducted',
      })
    }
  })

/** The answer to each refusal from `createEntry`; see `EntryCreateRefusal` for when each is raised. */
const REFUSALS: Record<EntryCreateRefusal, { status: number; error: string }> = {
  planNotFound: { status: 404, error: 'Plan not found or access denied' },
  slotTaken: { status: 409, error: 'Entry already exists for this date and meal type' },
  mealNotFound: { status: 404, error: 'Meal not found' },
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Auth check
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get household membership
  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const { household } = membership
  const { id: planId } = await params

  // Require date range to prevent accidental deletion of all entries
  const url = new URL(request.url)
  const startDateParam = url.searchParams.get('startDate')
  const endDateParam = url.searchParams.get('endDate')

  if (!startDateParam || !endDateParam) {
    return NextResponse.json(
      { error: 'startDate and endDate query params are required' },
      { status: 400 },
    )
  }

  try {
    // Scoped to the user's household, so another household's plan reads as missing.
    const deletedCount = await deleteEntriesInRange(
      household.id,
      planId,
      parseLocalDate(startDateParam),
      parseLocalDate(endDateParam),
    )

    if (deletedCount === null) {
      return NextResponse.json({ error: 'Meal plan not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, deletedCount })
  } catch (error) {
    captureApiError(error, { route: '/api/meal-plans/[id]/entries', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to delete entries' }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Auth check
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get household membership
  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const { household } = membership

  // Parse request body
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = createEntrySchema.safeParse(body)

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors
    return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
  }

  const { id: planId } = await params
  const { date, pick, restore, ...fields } = parsed.data

  // A log of a meal already eaten is for a past day only, in the household's
  // day (HON-1383). Today's meal is marked cooked from its card, which runs
  // the pantry deduction.
  if (fields.status === 'completed' && date >= getTodayInTimezone(household.timezone)) {
    return NextResponse.json(
      { error: 'Only a day before today can take a completed entry' },
      { status: 400 },
    )
  }

  // A pick ranks the slot as the suggestions route does, so it shares that
  // route's limit and cap check, in the same order. A plain create (the
  // selector's placeholder, Undo after Clear) is not throttled.
  if (pick) {
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
  }

  try {
    // The source rule (HON-1394): the picker lists only sources it allows, so
    // a refusal means the list went stale. The client tells it apart by `code`.
    const refused = fields.fridgeItems
      ? await findLeftoverSourceProblem(
          household.id,
          { date, mealType: fields.mealType },
          fields.fridgeItems,
          restore ? CHANGED_SOURCE_PROBLEMS : undefined,
        )
      : null
    if (refused) {
      return NextResponse.json(
        { error: 'Leftover source refused', code: 'leftover_source', ...refused },
        { status: 400 },
      )
    }

    // The plan, slot and meal checks live in `createEntry`.
    return NextResponse.json(
      pick
        ? await pickMealForSlot(
            household,
            planId,
            { date, mealType: fields.mealType },
            resolveHouseholdLocale(household),
          )
        : await createEntry(household.id, planId, {
            ...fields,
            date: parseLocalDate(date),
            // A log is saved as already charged, so Undo then Cooked never
            // charges the pantry for it (HON-1391).
            ...(fields.status === 'completed' && { pantryDeducted: true }),
          }),
    )
  } catch (error) {
    // The client tells this apart by `code`, and offers the picker instead.
    if (error instanceof NoSuggestionsError) {
      return NextResponse.json(
        { error: 'No meals available matching your preferences', code: 'no_suggestions' },
        { status: 404 },
      )
    }
    // A refusal is a deliberate answer rather than a route failure, so it
    // takes its status and is not reported as an error.
    if (error instanceof EntryCreateError) {
      const { status, error: message } = REFUSALS[error.reason]
      return NextResponse.json({ error: message }, { status })
    }
    if (error instanceof FridgeItemNotFoundError) {
      return NextResponse.json({ error: 'Fridge meal item not found' }, { status: 404 })
    }

    captureApiError(error, {
      route: '/api/meal-plans/[id]/entries',
      userId: session.user.id,
      householdId: household.id,
    })
    return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 })
  }
}
