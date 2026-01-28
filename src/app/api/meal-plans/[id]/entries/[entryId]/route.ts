import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { MealPlanEntryStatus } from '@/generated/prisma/enums'

const updateEntrySchema = z.object({
  status: z.enum(['planned', 'completed', 'skipped']).optional(),
  mealId: z.string().optional(),
  deductPantry: z.boolean().optional(),
})

export async function DELETE(
  _request: Request,
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

  // Extract params
  const { id: planId, entryId } = await params

  try {
    // Verify entry exists, belongs to the plan, and plan belongs to user's household
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
          select: {
            endDate: true,
          },
        },
      },
    })

    if (!entry) {
      return NextResponse.json({ error: 'Entry not found or access denied' }, { status: 404 })
    }

    // Reject deletion of past week plan entries (read-only)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (entry.plan.endDate < today) {
      return NextResponse.json({ error: 'Cannot modify past week plans' }, { status: 403 })
    }

    // Delete the entry
    await prisma.mealPlanEntry.delete({
      where: { id: entryId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete entry:', error)
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
    // Include meal components for pantry deduction
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
        mealId: true,
        plan: {
          select: {
            endDate: true,
            household: {
              select: {
                members: {
                  select: { id: true },
                },
              },
            },
          },
        },
        meal: {
          select: {
            components: {
              select: {
                ingredientId: true,
                quantityPerServing: true,
              },
            },
          },
        },
      },
    })

    if (!entry) {
      return NextResponse.json({ error: 'Entry not found or access denied' }, { status: 404 })
    }

    // Reject modifications to past week plans (read-only)
    // Exception: status changes (completed/skipped) are allowed for catch-up flow
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const isPastPlan = entry.plan.endDate < today
    const isStatusOnlyUpdate = parsed.data.status && !parsed.data.mealId

    if (isPastPlan && !isStatusOnlyUpdate) {
      return NextResponse.json({ error: 'Cannot modify past week plans' }, { status: 403 })
    }

    // Build update data
    const updateData: {
      status?: MealPlanEntryStatus
      mealId?: string
      preparationTips?: null
    } = {}

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
      // Clear cached preparation tips when meal is swapped
      updateData.preparationTips = null
    }

    // Require at least one field to update
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    // Handle pantry deduction when marking as completed
    const shouldDeductPantry =
      parsed.data.deductPantry === true &&
      parsed.data.status === 'completed' &&
      entry.meal?.components.length

    if (shouldDeductPantry) {
      const householdSize = entry.plan.household.members.length
      const components = entry.meal!.components

      // Fetch pantry items for the household
      const pantryItems = await prisma.pantryItem.findMany({
        where: {
          householdId: household.id,
          ingredientId: { in: components.map((c) => c.ingredientId) },
        },
      })

      const pantryMap = new Map(pantryItems.map((item) => [item.ingredientId, item]))

      // Prepare deduction operations
      const itemsToDelete: string[] = []
      const itemsToUpdate: { id: string; newQuantity: number }[] = []

      for (const component of components) {
        const pantryItem = pantryMap.get(component.ingredientId)

        // Skip if not in pantry or is a staple
        if (!pantryItem || pantryItem.isStaple) continue

        const deductionAmount = component.quantityPerServing * householdSize

        // If quantity is null, remove from pantry (treat as fully consumed)
        if (pantryItem.quantity === null) {
          itemsToDelete.push(pantryItem.id)
          continue
        }

        const newQuantity = pantryItem.quantity - deductionAmount

        if (newQuantity <= 0) {
          // Remove item if depleted
          itemsToDelete.push(pantryItem.id)
        } else {
          // Update with new quantity
          itemsToUpdate.push({ id: pantryItem.id, newQuantity })
        }
      }

      // Execute all operations in a transaction
      await prisma.$transaction([
        // Update the entry status
        prisma.mealPlanEntry.update({
          where: { id: entryId },
          data: updateData,
        }),
        // Delete depleted items
        ...(itemsToDelete.length > 0
          ? [
              prisma.pantryItem.deleteMany({
                where: { id: { in: itemsToDelete } },
              }),
            ]
          : []),
        // Update quantities
        ...itemsToUpdate.map((item) =>
          prisma.pantryItem.update({
            where: { id: item.id },
            data: { quantity: item.newQuantity },
          }),
        ),
      ])

      return NextResponse.json({
        id: entryId,
        status: updateData.status,
        mealId: updateData.mealId ?? entry.mealId,
        pantryDeducted: true,
      })
    }

    // Standard update without pantry deduction
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
