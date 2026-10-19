import { NextResponse } from 'next/server'
import { z } from 'zod'
import { captureApiError } from '@/lib/errors'
import { EntryChangeError } from '@/lib/meal-plans/entry-changes'
import { promoteEntry } from '@/lib/meal-plans/promote-entry'
import { refusalResponse, requireHousehold } from '../refusals'

type RouteContext = { params: Promise<{ id: string; entryId: string }> }

const ROUTE = '/api/meal-plans/[id]/entries/[entryId]/components/promote'

/** The new recipe's name; the household meal create bounds. Unused on an update. */
const promoteSchema = z.object({ name: z.string().trim().min(1).max(200) })

/**
 * "Make it my recipe" (HON-1245): keeps the entry's ingredient changes as a
 * household recipe. `promoteEntry` decides between forking a library meal and
 * updating the household's own recipe; this route owns the session and the
 * body. Answers `{ outcome, mealId }`.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const caller = await requireHousehold()
  if (!caller.ok) return caller.response

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = promoteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    )
  }

  const { id: planId, entryId } = await params

  try {
    return NextResponse.json(await promoteEntry(caller.householdId, planId, entryId, parsed.data))
  } catch (error) {
    if (error instanceof EntryChangeError) return refusalResponse(error.reason)
    captureApiError(error, { route: ROUTE, userId: caller.userId })
    return NextResponse.json({ error: 'Failed to save the recipe' }, { status: 500 })
  }
}
