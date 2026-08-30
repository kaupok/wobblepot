import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'

const patchSchema = z.object({
  checked: z.boolean().optional(),
  ingredientId: z.string().nullable().optional(),
})

/**
 * PATCH /api/shopping-list/custom/[id]
 *
 * Update a custom shopping item: toggle checked or update ingredient link.
 * When checking a linked item, also creates/touches a pantry item.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const membership = await getHouseholdMembership(session.user.id)

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    const { household } = membership
    const { id } = await params

    // Find the item and verify it belongs to this household
    const item = await prisma.customShoppingItem.findUnique({
      where: { id },
    })

    if (!item || item.householdId !== household.id) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = patchSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { checked, ingredientId } = parsed.data

    // Build update data
    const updateData: { checked?: boolean; ingredientId?: string | null } = {}
    if (checked !== undefined) updateData.checked = checked
    if (ingredientId !== undefined) updateData.ingredientId = ingredientId

    // If checking a linked item, also add to pantry
    const effectiveIngredientId = ingredientId !== undefined ? ingredientId : item.ingredientId
    const isChecking = checked === true && !item.checked

    const updated = await prisma.$transaction(async (tx) => {
      const updatedItem = await tx.customShoppingItem.update({
        where: { id },
        data: updateData,
        include: {
          ingredient: {
            select: { id: true, name: true, category: true },
          },
        },
      })

      // When checking a linked item, upsert pantry item (quantity = null = "have some")
      if (isChecking && effectiveIngredientId) {
        await tx.pantryItem.upsert({
          where: {
            householdId_ingredientId: {
              householdId: household.id,
              ingredientId: effectiveIngredientId,
            },
          },
          create: {
            householdId: household.id,
            ingredientId: effectiveIngredientId,
            quantity: null,
            isStaple: false,
          },
          update: {
            // Touch updatedAt
          },
        })
      }

      return updatedItem
    })

    return NextResponse.json({ item: updated }, { status: 200 })
  } catch (error) {
    captureApiError(error, {
      route: '/api/shopping-list/custom/[id]',
      userId: session.user.id,
    })
    return NextResponse.json({ error: 'Failed to update item' }, { status: 500 })
  }
}

/**
 * DELETE /api/shopping-list/custom/[id]
 *
 * Remove a single custom shopping item.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const membership = await getHouseholdMembership(session.user.id)

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    const { household } = membership
    const { id } = await params

    // Find and verify ownership
    const item = await prisma.customShoppingItem.findUnique({
      where: { id },
    })

    if (!item || item.householdId !== household.id) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    await prisma.customShoppingItem.delete({
      where: { id },
    })

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    captureApiError(error, {
      route: '/api/shopping-list/custom/[id]',
      userId: session.user.id,
    })
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 })
  }
}
