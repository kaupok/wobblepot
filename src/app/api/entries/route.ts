import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import type { MealPlanEntryStatus } from '@/generated/prisma/enums'
import { captureApiError } from '@/lib/errors'

const VALID_STATUSES: string[] = ['planned', 'completed', 'skipped']

/**
 * GET /api/entries?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&status=planned
 *
 * Query entries by arbitrary date range for the authenticated user's household.
 * Returns entries from the household's single plan within the date range. The
 * read itself lives in `loadPlanEntries`, which the Today page calls directly.
 */
export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const { household } = membership

  // Parse query params
  const startDateParam = request.nextUrl.searchParams.get('startDate')
  const endDateParam = request.nextUrl.searchParams.get('endDate')
  const statusParam = request.nextUrl.searchParams.get('status')

  if (!startDateParam || !endDateParam) {
    return NextResponse.json(
      { error: 'startDate and endDate query params are required (YYYY-MM-DD)' },
      { status: 400 },
    )
  }

  let startDate: Date
  let endDate: Date
  try {
    startDate = parseLocalDate(startDateParam)
    endDate = parseLocalDate(endDateParam)
  } catch {
    return NextResponse.json({ error: 'Invalid date format. Use YYYY-MM-DD.' }, { status: 400 })
  }

  if (statusParam && !VALID_STATUSES.includes(statusParam)) {
    return NextResponse.json({ error: 'Invalid status value' }, { status: 400 })
  }

  try {
    const result = await loadPlanEntries(household, {
      startDate,
      endDate,
      status: (statusParam as MealPlanEntryStatus | null) ?? undefined,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    captureApiError(error, {
      route: '/api/entries',
      userId: session.user.id,
      householdId: household.id,
    })
    return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 })
  }
}
