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
        status: true,
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
      // Verify the meal exists *and* that this household may see it. Without
      // the visibility filter a caller could attach another household's custom
      // meal to their entry, which `/api/meal-plans/current` then serialises
      // back to them in full — and whose components the deduction below would
      // charge their pantry for. Same rule as `/api/meals/[id]/favorite`.
      const meal = await prisma.meal.findFirst({
        where: {
          id: parsed.data.mealId,
          deletedAt: null,
          OR: [{ householdId: null }, { householdId: household.id }],
        },
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

    // Handle pantry deduction when marking as completed. Deduction is not
    // idempotent, and reverting to `planned` does not restock, so an entry
    // that is already completed must not be charged a second time — otherwise
    // completed → planned → completed takes the ingredients twice for one
    // cooked meal.
    const shouldDeductPantry =
      parsed.data.deductPantry === true &&
      parsed.data.status === 'completed' &&
      entry.status !== MealPlanEntryStatus.completed &&
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
      // How much of each ingredient this meal consumes. The database applies
      // these as relative decrements — nothing here reads a pantry quantity,
      // because reading one is what used to lose deductions: two entries
      // sharing an ingredient and completed at the same moment both read the
      // same starting quantity and the second write overwrote the first
      // (1000g, −300g and −200g, left the pantry at 800g instead of 500g).
      // `decrement` makes the two compose (HON-625).
      const deductions = componentsToDeduct
        .map((component) => ({
          ingredientId: component.ingredientId,
          amount: component.quantityPerServing * effectiveServings,
        }))
        // Take the pantry row locks in a deterministic order. `meal.components`
        // is selected without an `orderBy`, so two meals sharing ingredients
        // can list them in opposite orders — and two completions locking the
        // same rows in opposite orders deadlock (Postgres 40P01), which the
        // catch below turns into a 500 that rolls the whole completion back.
        .sort((a, b) => a.ingredientId.localeCompare(b.ingredientId))

      const pantryDeducted = await prisma.$transaction(async (tx) => {
        // Claim the completion, and let the database decide who won. The
        // `status` this guards on was read at the top of the handler, outside
        // any transaction, so `shouldDeductPantry` alone cannot keep two
        // concurrent completions of the *same* entry (a double submit, two
        // tabs, a client retry) from both passing it and both deducting —
        // charging the pantry twice for one cooked meal. Re-testing it here as
        // a conditional write makes it a no-op for the loser: it takes the
        // entry's row lock, so the second transaction only proceeds once the
        // first has committed `completed`.
        const claimed = await tx.mealPlanEntry.updateMany({
          where: { id: entryId, status: { not: MealPlanEntryStatus.completed } },
          data: updateData,
        })

        if (claimed.count === 0) {
          // Lost the race. Persist the rest of the update but charge nothing —
          // exactly what this request would have done had it arrived after the
          // winner committed, and read `completed` at the top.
          await tx.mealPlanEntry.update({ where: { id: entryId }, data: updateData })
          return false
        }

        // Deduct each ingredient. `householdId` + `ingredientId` is unique, so
        // this matches at most one row; `updateMany` (rather than `update`) is
        // what makes an ingredient the household has no pantry row for a
        // no-op instead of a throw. Staples are exempt from deduction, and a
        // null quantity means "some, amount unknown" — there is nothing to
        // subtract from, so both are filtered out here and the null rows are
        // picked up by the cleanup below.
        for (const { ingredientId, amount } of deductions) {
          await tx.pantryItem.updateMany({
            where: {
              householdId: household.id,
              ingredientId,
              isStaple: false,
              quantity: { not: null },
            },
            data: { quantity: { decrement: amount } },
          })
        }

        // Clear out what the deduction emptied. This runs last on purpose: it
        // is evaluated against the post-decrement quantity, which is the only
        // way to judge depletion without the application-side read above. A
        // row the deduction overshot is briefly negative, but never outside
        // this transaction. Unquantified rows (`quantity: null`) are consumed
        // in full by cooking with them, so they go too.
        await tx.pantryItem.deleteMany({
          where: {
            householdId: household.id,
            ingredientId: { in: deductions.map((d) => d.ingredientId) },
            isStaple: false,
            OR: [{ quantity: null }, { quantity: { lte: 0 } }],
          },
        })

        return true
      })

      return NextResponse.json({
        id: entryId,
        status: updateData.status,
        mealId: updateData.mealId ?? entry.mealId,
        rating: updateData.rating,
        pantryDeducted,
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
