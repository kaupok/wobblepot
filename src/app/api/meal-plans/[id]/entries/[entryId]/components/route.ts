import { NextResponse } from 'next/server'
import type { z } from 'zod'

import { captureApiError } from '@/lib/errors'
import { entryChangeSchema, entryChangeSetSchema } from '@/lib/meal-planning/components-schema'
import {
  addEntryChange,
  EntryChangeError,
  replaceEntryChanges,
} from '@/lib/meal-plans/entry-changes'

import { refusalResponse, requireHousehold } from './refusals'

type RouteContext = { params: Promise<{ id: string; entryId: string }> }

const ROUTE = '/api/meal-plans/[id]/entries/[entryId]/components'

/** The body, parsed with `schema`, or the 400 that refuses it. */
async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ ok: true; data: z.output<S> } | { ok: false; response: NextResponse }> {
  let body
  try {
    body = await request.json()
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues.map((i) => i.message) },
        { status: 400 },
      ),
    }
  }
  return { ok: true, data: parsed.data }
}

/**
 * Changes one ingredient of one planned entry (HON-1243): replace it, leave it
 * out, or add one. The meal stays shared and untouched. Every rule lives in
 * `addEntryChange`; this route owns the session and the body.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const caller = await requireHousehold()
  if (!caller.ok) return caller.response

  const body = await parseBody(request, entryChangeSchema)
  if (!body.ok) return body.response

  const { id: planId, entryId } = await params

  try {
    const result = await addEntryChange(caller.householdId, planId, entryId, body.data)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof EntryChangeError) return refusalResponse(error.reason)
    captureApiError(error, { route: ROUTE, userId: caller.userId })
    return NextResponse.json({ error: 'Failed to change the ingredient' }, { status: 500 })
  }
}

/**
 * Replaces the entry's whole change set, and stores the instruction it came
 * from (HON-1244, "Adjust recipe"). The same refusals as the POST, checked
 * across the set by `replaceEntryChanges`.
 */
export async function PUT(request: Request, { params }: RouteContext) {
  const caller = await requireHousehold()
  if (!caller.ok) return caller.response

  const body = await parseBody(request, entryChangeSetSchema)
  if (!body.ok) return body.response

  const { id: planId, entryId } = await params

  try {
    return NextResponse.json(
      await replaceEntryChanges(caller.householdId, planId, entryId, body.data),
    )
  } catch (error) {
    if (error instanceof EntryChangeError) return refusalResponse(error.reason)
    captureApiError(error, { route: ROUTE, userId: caller.userId })
    return NextResponse.json({ error: 'Failed to change the ingredients' }, { status: 500 })
  }
}
