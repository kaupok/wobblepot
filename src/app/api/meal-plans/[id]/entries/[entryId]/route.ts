import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { discardPlaceholder } from '@/lib/meal-plans/discard-placeholder'
import {
  deleteEntry,
  EntryUpdateError,
  updateEntry,
  type EntryUpdateRefusal,
} from '@/lib/meal-plans/entries'
import { fridgeItemsSchema } from '@/lib/meal-plans/fridge-items'
import {
  FridgeItemNotFoundError,
  setFridgeItems,
  SetFridgeItemsError,
} from '@/lib/meal-plans/fridge-meal'
import { findLeftoverProblemForEntry } from '@/lib/meal-plans/recent-meals'

/** One axis of the note's place on the card: a fraction of its room (`NotePosition`), or null for the default. */
const notePositionAxis = z.number().min(0).max(1).nullable().optional()

const updateEntrySchema = z
  .object({
    status: z.enum(['planned', 'completed', 'skipped']).optional(),
    mealId: z.string().optional(),
    deductPantry: z.boolean().optional(),
    note: z.string().max(200).nullable().optional(),
    noteX: notePositionAxis,
    noteY: notePositionAxis,
    servingOverride: z.number().int().min(1).max(20).nullable().optional(),
    rating: z.enum(['up', 'down']).nullable().optional(),
    // A fridge meal (HON-1277): `fridgeItems` makes the entry one with these
    // items, and `usedUpIngredientIds` names the pantry items its completion
    // runs out.
    fridgeItems: fridgeItemsSchema.optional(),
    usedUpIngredientIds: z.array(z.string().min(1)).max(30).optional(),
  })
  // The note's place is one point: both axes or neither, both set or both
  // null (HON-975). A place beside a cleared note contradicts it, because
  // clearing the note clears the place.
  .superRefine((data, ctx) => {
    // Writing the items is its own request, so it cannot half-apply beside
    // a status or a swap.
    if (data.fridgeItems && Object.keys(data).length > 1) {
      ctx.addIssue({ code: 'custom', path: ['fridgeItems'], message: 'fridgeItems goes alone' })
    }
    if (data.usedUpIngredientIds && (data.status !== 'completed' || data.mealId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['usedUpIngredientIds'],
        message: 'usedUpIngredientIds needs status completed and no mealId',
      })
    }
    if ('noteX' in data !== 'noteY' in data || (data.noteX === null) !== (data.noteY === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['noteX'],
        message: 'noteX and noteY are set together',
      })
    }
    if (data.note === null && data.noteX != null) {
      ctx.addIssue({ code: 'custom', path: ['noteX'], message: 'A cleared note has no position' })
    }
  })

/** The answer to each refusal from `updateEntry`; see `EntryUpdateRefusal` for when each is raised. */
const REFUSALS: Record<EntryUpdateRefusal, { status: number; error: string }> = {
  entryNotFound: { status: 404, error: 'Entry not found or access denied' },
  mealNotFound: { status: 404, error: 'Meal not found' },
  noFields: { status: 400, error: 'No fields to update' },
  completedSwap: { status: 409, error: 'Cannot swap a completed meal' },
  completedServings: { status: 409, error: 'Cannot change servings on a completed meal' },
  staleMeal: { status: 409, error: 'The meal changed while completing. Try again.' },
  noNote: { status: 409, error: 'Entry has no note' },
}

export async function DELETE(
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

  // Get household membership
  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  // Extract params
  const { id: planId, entryId } = await params

  try {
    // The picker discards its placeholder with `?placeholder`, which deletes
    // the entry only while it has no meal and no note: the discard sent as
    // the page unloads can land after the pick it raced (HON-1251).
    if (new URL(request.url).searchParams.has('placeholder')) {
      if (!(await discardPlaceholder(membership.household.id, planId, entryId))) {
        return NextResponse.json({ error: 'No placeholder entry to discard' }, { status: 404 })
      }
      return NextResponse.json({ success: true })
    }

    // Scoped to the plan and to the user's household, so another household's
    // entry reads as missing.
    if (!(await deleteEntry(membership.household.id, planId, entryId))) {
      return NextResponse.json({ error: 'Entry not found or access denied' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    captureApiError(error, {
      route: '/api/meal-plans/[id]/entries/[entryId]',
      userId: session.user.id,
    })
    return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 })
  }
}

export async function PATCH(
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

  // Get household membership
  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  // Parse request body
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = updateEntrySchema.safeParse(body)

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors
    return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
  }

  // Extract params
  const { id: planId, entryId } = await params

  try {
    const { fridgeItems, ...patch } = parsed.data
    if (fridgeItems) {
      // The source rule (HON-1394). Items the entry already stores pass, so
      // Edit items can send them back as read.
      const refused = await findLeftoverProblemForEntry(
        membership.household.id,
        entryId,
        fridgeItems,
      )
      if (refused) {
        return NextResponse.json(
          { error: 'Leftover source refused', code: 'leftover_source', ...refused },
          { status: 400 },
        )
      }
      return NextResponse.json(
        await setFridgeItems(membership.household.id, planId, entryId, fridgeItems),
      )
    }
    // The entry rules (a completed entry keeps its meal and count, the pantry
    // is charged at most once) and the completion transaction live in
    // `updateEntry`.
    return NextResponse.json(await updateEntry(membership.household.id, planId, entryId, patch))
  } catch (error) {
    if (error instanceof SetFridgeItemsError) {
      return error.reason === 'entryNotFound'
        ? NextResponse.json({ error: REFUSALS.entryNotFound.error }, { status: 404 })
        : NextResponse.json({ error: 'Cannot change a completed meal' }, { status: 409 })
    }
    if (error instanceof FridgeItemNotFoundError) {
      return NextResponse.json({ error: 'Fridge meal item not found' }, { status: 404 })
    }
    // A refusal is a deliberate answer rather than a route failure, so it
    // takes its status and is not reported as an error (HON-633).
    if (error instanceof EntryUpdateError) {
      const { status, error: message } = REFUSALS[error.reason]
      return NextResponse.json({ error: message }, { status })
    }

    captureApiError(error, {
      route: '/api/meal-plans/[id]/entries/[entryId]',
      userId: session.user.id,
    })
    return NextResponse.json({ error: 'Failed to update entry status' }, { status: 500 })
  }
}
