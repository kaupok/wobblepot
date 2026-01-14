import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { MealPlanEntryStatus } from '@/generated/prisma/enums'

const updateEntrySchema = z.object({
  status: z.enum(['planned', 'completed', 'skipped', 'eating_out', 'leftovers']).optional(),
  mealId: z.string().optional(),
})

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

  const { household } = membership

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
    // Verify entry exists, belongs to the plan, and plan belongs to user's household
    // Single atomic query eliminates race conditions between separate verification steps
    const entry = await prisma.mealPlanEntry.findFirst({
      where: {
        id: entryId,
        planId: planId,
        plan: {
          householdId: household.id,
        },
      },
      select: {
        id: true,
        plan: {
          select: { endDate: true },
        },
      },
    })

    if (!entry) {
      return NextResponse.json({ error: 'Entry not found or access denied' }, { status: 404 })
    }

    // Reject modifications to past week plans (read-only)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (entry.plan.endDate < today) {
      return NextResponse.json({ error: 'Cannot modify past week plans' }, { status: 403 })
    }

    // Build update data
    const updateData: { status?: MealPlanEntryStatus; mealId?: string } = {}

    if (parsed.data.status) {
      updateData.status = parsed.data.status as MealPlanEntryStatus
    }

    if (parsed.data.mealId) {
      // Verify meal exists before updating
      const meal = await prisma.meal.findUnique({
        where: { id: parsed.data.mealId },
        select: { id: true },
      })

      if (!meal) {
        return NextResponse.json({ error: 'Meal not found' }, { status: 404 })
      }

      updateData.mealId = parsed.data.mealId
    }

    // Require at least one field to update
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    // Update entry
    const updatedEntry = await prisma.mealPlanEntry.update({
      where: { id: entryId },
      data: updateData,
    })

    return NextResponse.json({
      id: updatedEntry.id,
      status: updatedEntry.status,
      mealId: updatedEntry.mealId,
    })
  } catch (error) {
    console.error('Failed to update entry status:', error)
    return NextResponse.json({ error: 'Failed to update entry status' }, { status: 500 })
  }
}
