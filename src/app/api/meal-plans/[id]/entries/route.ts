import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { captureApiError } from '@/lib/errors'
import {
  createEntry,
  deleteEntriesInRange,
  EntryCreateError,
  type EntryCreateRefusal,
} from '@/lib/meal-plans/entries'

/** One axis of the note's place on the card: a fraction of its room (`NotePosition`), or null for the default. */
const notePositionAxis = z.number().min(0).max(1).nullable().optional()

// The fields past `note` are for Undo after Clear, which posts the cleared
// entry back (HON-1123). A completed entry offers no Clear, and a restore
// must not create a completed row the pantry was never charged for, so
// `status` stops at `skipped`.
const createEntrySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    mealType: z.enum(['breakfast', 'lunch', 'dinner']),
    mealId: z.string().optional(),
    note: z.string().max(200).nullable().optional(),
    noteX: notePositionAxis,
    noteY: notePositionAxis,
    status: z.enum(['planned', 'skipped']).optional(),
    servingOverride: z.number().int().min(1).max(20).nullable().optional(),
    rating: z.enum(['up', 'down']).nullable().optional(),
    pantryDeducted: z.boolean().optional(),
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
  const { date, ...fields } = parsed.data

  try {
    // The plan, slot and meal checks live in `createEntry`.
    return NextResponse.json(
      await createEntry(household.id, planId, { ...fields, date: parseLocalDate(date) }),
    )
  } catch (error) {
    // A refusal is a deliberate answer rather than a route failure, so it
    // takes its status and is not reported as an error.
    if (error instanceof EntryCreateError) {
      const { status, error: message } = REFUSALS[error.reason]
      return NextResponse.json({ error: message }, { status })
    }

    captureApiError(error, {
      route: '/api/meal-plans/[id]/entries',
      userId: session.user.id,
      householdId: household.id,
    })
    return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 })
  }
}
