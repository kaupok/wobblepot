import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'

const updatePantryItemSchema = z.object({
  quantity: z.number().nullable().optional(),
  isStaple: z.boolean().optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = updatePantryItemSchema.safeParse(body)

    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
    }

    const membership = await getHouseholdMembership(session.user.id)

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    const { id } = await params

    // Find the pantry item and verify it belongs to user's household
    const pantryItem = await prisma.pantryItem.findFirst({
      where: {
        id,
        householdId: membership.householdId,
      },
    })

    if (!pantryItem) {
      return NextResponse.json({ error: 'Pantry item not found' }, { status: 404 })
    }

    // Build update data only with provided fields
    const updateData: { quantity?: number | null; isStaple?: boolean } = {}
    if (parsed.data.quantity !== undefined) {
      updateData.quantity = parsed.data.quantity
    }
    if (parsed.data.isStaple !== undefined) {
      updateData.isStaple = parsed.data.isStaple
    }

    const updated = await prisma.pantryItem.update({
      where: { id },
      data: updateData,
      include: {
        ingredient: {
          select: {
            id: true,
            name: true,
            category: true,
            defaultUnit: true,
          },
        },
      },
    })

    return NextResponse.json({
      id: updated.id,
      ingredient: updated.ingredient,
      quantity: updated.quantity,
      isStaple: updated.isStaple,
      updatedAt: updated.updatedAt,
    })
  } catch (error) {
    captureApiError(error, { route: '/api/pantry/[id]', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to update pantry item' }, { status: 500 })
  }
}

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

    const { id } = await params

    // Find the pantry item and verify it belongs to user's household
    const pantryItem = await prisma.pantryItem.findFirst({
      where: {
        id,
        householdId: membership.householdId,
      },
    })

    if (!pantryItem) {
      return NextResponse.json({ error: 'Pantry item not found' }, { status: 404 })
    }

    await prisma.pantryItem.delete({
      where: { id },
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    captureApiError(error, { route: '/api/pantry/[id]', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to delete pantry item' }, { status: 500 })
  }
}
