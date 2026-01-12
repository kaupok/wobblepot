import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { MealPlanEntryStatus } from '@/generated/prisma/enums'

const updateEntrySchema = z.object({
  status: z.enum(['planned', 'completed', 'skipped', 'eating_out', 'leftovers']),
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
    // Verify plan exists and belongs to user's household
    const plan = await prisma.mealPlan.findUnique({
      where: { id: planId },
      select: { householdId: true },
    })

    if (!plan) {
      return NextResponse.json({ error: 'Meal plan not found' }, { status: 404 })
    }

    if (plan.householdId !== household.id) {
      return NextResponse.json({ error: 'Access denied to this meal plan' }, { status: 403 })
    }

    // Verify entry exists and belongs to this plan
    const entry = await prisma.mealPlanEntry.findUnique({
      where: { id: entryId },
      select: { planId: true },
    })

    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    }

    if (entry.planId !== planId) {
      return NextResponse.json({ error: 'Entry does not belong to this plan' }, { status: 400 })
    }

    // Update entry status
    const updatedEntry = await prisma.mealPlanEntry.update({
      where: { id: entryId },
      data: {
        status: parsed.data.status as MealPlanEntryStatus,
      },
    })

    return NextResponse.json({
      id: updatedEntry.id,
      status: updatedEntry.status,
    })
  } catch (error) {
    console.error('Failed to update entry status:', error)
    return NextResponse.json({ error: 'Failed to update entry status' }, { status: 500 })
  }
}
