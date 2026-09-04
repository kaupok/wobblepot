import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { MealPlanEntryStatus, EntryRating } from '@/generated/prisma/enums'
import { captureApiError } from '@/lib/errors'
import { getEffectiveServings } from '@/lib/meal-planning/servings'

const updateEntrySchema = z.object({
  status: z.enum(['planned', 'completed', 'skipped']).optional(),
  mealId: z.string().optional(),
  deductPantry: z.boolean().optional(),
  note: z.string().max(200).nullable().optional(),
  servingOverride: z.number().int().min(1).max(20).nullable().optional(),
  rating: z.enum(['up', 'down']).nullable().optional(),
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
      },
    })

    if (!entry) {
      return NextResponse.json({ error: 'Entry not found or access denied' }, { status: 404 })
    }

    // Delete the entry
    await prisma.mealPlanEntry.delete({
      where: { id: entryId },
    })

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
        servingOverride: true,
        plan: {
          select: {
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

    // Build update data
    const updateData: {
      status?: MealPlanEntryStatus
      mealId?: string
      preparationTips?: null
      note?: string | null
      servingOverride?: number | null
      rating?: EntryRating | null
    } = {}

    if (parsed.data.status) {
      updateData.status = parsed.data.status as MealPlanEntryStatus
    }

    // Components of the meal this request swaps to, if it swaps at all. The
    // pantry deduction below has to charge for what gets cooked, and on a swap
    // that is the incoming meal — not the one `entry` was read with.
    let swapMealComponents: { ingredientId: string; quantityPerServing: number }[] | undefined

    if (parsed.data.mealId) {
      // Verify meal exists before updating
      const meal = await prisma.meal.findUnique({
        where: { id: parsed.data.mealId },
        select: {
          id: true,
          components: {
            select: {
              ingredientId: true,
              quantityPerServing: true,
            },
          },
        },
      })

      if (!meal) {
        return NextResponse.json({ error: 'Meal not found' }, { status: 404 })
      }

      swapMealComponents = meal.components
      updateData.mealId = parsed.data.mealId
      // Clear cached preparation tips when meal is swapped
      updateData.preparationTips = null
      // Reset serving override when meal is swapped
      updateData.servingOverride = null
    }

    // Handle note updates (including explicit null to clear)
    if ('note' in parsed.data) {
      updateData.note = parsed.data.note ?? null
    }

    // Handle servingOverride updates (including explicit null to reset to household default)
    if ('servingOverride' in parsed.data) {
      updateData.servingOverride = parsed.data.servingOverride ?? null
    }

    // Handle rating updates (including explicit null to clear)
    if ('rating' in parsed.data) {
      updateData.rating = (parsed.data.rating as EntryRating) ?? null
    }

    // Require at least one field to update
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    // Deduct the components of the meal this request persists. On a swap the
    // entry ends up pointing at the incoming meal, so charging the household
    // for `entry.meal` would take ingredients it never cooked and leave the
    // ones it did cook in the pantry (HON-622).
    const componentsToDeduct = swapMealComponents ?? entry.meal?.components ?? []

    // Handle pantry deduction when marking as completed
    const shouldDeductPantry =
      parsed.data.deductPantry === true &&
      parsed.data.status === 'completed' &&
      componentsToDeduct.length > 0

    if (shouldDeductPantry) {
      const householdSize = entry.plan.household.members.length
      // Scale by what this request persists, not by the row read at the top:
      // `updateEntrySchema` accepts `servingOverride` alongside
      // `status: 'completed'` + `deductPantry`, and a meal swap resets the
      // override to null — either way `entry.servingOverride` is already stale
      // by the time the transaction below runs.
      const effectiveServings = getEffectiveServings(
        'servingOverride' in updateData
          ? { servingOverride: updateData.servingOverride ?? null }
          : entry,
        householdSize,
      )
      const components = componentsToDeduct

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

        const deductionAmount = component.quantityPerServing * effectiveServings

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
        rating: updateData.rating,
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
      rating: updatedEntry.rating,
    })
  } catch (error) {
    captureApiError(error, {
      route: '/api/meal-plans/[id]/entries/[entryId]',
      userId: session.user.id,
    })
    return NextResponse.json({ error: 'Failed to update entry status' }, { status: 500 })
  }
}
