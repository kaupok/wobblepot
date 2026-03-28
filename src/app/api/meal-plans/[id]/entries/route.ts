import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { parseLocalDate, toDateString } from '@/lib/meal-planning/dates'

const createEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  mealType: z.enum(['breakfast', 'lunch', 'dinner']),
  mealId: z.string().optional(),
  note: z.string().max(200).nullable().optional(),
})

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

  try {
    // Verify plan exists and belongs to user's household
    const plan = await prisma.mealPlan.findFirst({
      where: {
        id: planId,
        householdId: household.id,
      },
      select: {
        id: true,
      },
    })

    if (!plan) {
      return NextResponse.json({ error: 'Meal plan not found' }, { status: 404 })
    }

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

    const weekStart = parseLocalDate(startDateParam)
    const weekEnd = parseLocalDate(endDateParam)

    // Delete entries within the specified date range
    const result = await prisma.mealPlanEntry.deleteMany({
      where: { planId, date: { gte: weekStart, lt: weekEnd } },
    })

    return NextResponse.json({ success: true, deletedCount: result.count })
  } catch (error) {
    console.error('Failed to delete entries:', error)
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
  const { date, mealType, mealId, note } = parsed.data

  try {
    // Verify plan exists and belongs to user's household
    const plan = await prisma.mealPlan.findFirst({
      where: {
        id: planId,
        householdId: household.id,
      },
      select: {
        id: true,
      },
    })

    if (!plan) {
      return NextResponse.json({ error: 'Plan not found or access denied' }, { status: 404 })
    }

    const entryDate = parseLocalDate(date)

    // Check if an entry already exists for this date + mealType
    const existingEntry = await prisma.mealPlanEntry.findFirst({
      where: {
        planId,
        date: entryDate,
        mealType,
      },
    })

    if (existingEntry) {
      return NextResponse.json(
        { error: 'Entry already exists for this date and meal type' },
        { status: 409 },
      )
    }

    // If mealId provided, verify meal exists
    if (mealId) {
      const meal = await prisma.meal.findUnique({
        where: { id: mealId },
        select: { id: true },
      })

      if (!meal) {
        return NextResponse.json({ error: 'Meal not found' }, { status: 404 })
      }
    }

    // Create the entry
    const entry = await prisma.mealPlanEntry.create({
      data: {
        planId,
        date: entryDate,
        mealType,
        mealId: mealId ?? null,
        status: 'planned',
        note: note ?? null,
      },
    })

    return NextResponse.json({
      id: entry.id,
      date: toDateString(entry.date),
      mealType: entry.mealType,
      status: entry.status,
      mealId: entry.mealId,
      note: entry.note,
    })
  } catch (error) {
    console.error('Failed to create entry:', error)
    return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 })
  }
}
