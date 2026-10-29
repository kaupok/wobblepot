import { NextResponse } from 'next/server'

import { captureApiError } from '@/lib/errors'
import { EntryChangeError, removeEntryChange } from '@/lib/meal-plans/entry-changes'

import { refusalResponse, requireHousehold } from '../refusals'

/** Undoes one ingredient change on a planned entry (HON-1243). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; entryId: string; componentId: string }> },
) {
  const caller = await requireHousehold()
  if (!caller.ok) return caller.response

  const { id: planId, entryId, componentId } = await params

  try {
    return NextResponse.json(
      await removeEntryChange(caller.householdId, planId, entryId, componentId),
    )
  } catch (error) {
    if (error instanceof EntryChangeError) return refusalResponse(error.reason)
    captureApiError(error, {
      route: '/api/meal-plans/[id]/entries/[entryId]/components/[componentId]',
      userId: caller.userId,
    })
    return NextResponse.json({ error: 'Failed to undo the change' }, { status: 500 })
  }
}
