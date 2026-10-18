import { NextResponse } from 'next/server'
import { captureApiError } from '@/lib/errors'
import { entryChangeSchema } from '@/lib/meal-planning/components-schema'
import { addEntryChange, EntryChangeError } from '@/lib/meal-plans/entry-changes'
import { refusalResponse, requireHousehold } from './refusals'

/**
 * Changes one ingredient of one planned entry (HON-1243): replace it, leave it
 * out, or add one. The meal stays shared and untouched. Every rule lives in
 * `addEntryChange`; this route owns the session and the body.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const caller = await requireHousehold()
  if (!caller.ok) return caller.response

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = entryChangeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    )
  }

  const { id: planId, entryId } = await params

  try {
    const result = await addEntryChange(caller.householdId, planId, entryId, parsed.data)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof EntryChangeError) return refusalResponse(error.reason)
    captureApiError(error, {
      route: '/api/meal-plans/[id]/entries/[entryId]/components',
      userId: caller.userId,
    })
    return NextResponse.json({ error: 'Failed to change the ingredient' }, { status: 500 })
  }
}
