import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership, loadHouseholdServings } from '@/lib/household'
import { sumPortions } from '@/lib/meal-planning/servings'
import { prisma } from '@/lib/prisma'
import { captureApiError } from '@/lib/errors'
import { invalidateFutureEntryTips } from '@/lib/meal-planning/preparation-tips-cache'

const updateMemberSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  preferences: z
    .object({
      displayName: z
        .string()
        .trim()
        .max(50)
        .transform((v) => (v === '' ? null : v))
        .nullable()
        .optional(),
      portionMultiplier: z.number().min(0.5).max(3.0).optional(),
      targetCalories: z.number().int().min(500).max(5000).nullable().optional(),
      targetProtein: z.number().int().min(0).max(500).nullable().optional(),
      targetCarbs: z.number().int().min(0).max(500).nullable().optional(),
      targetFat: z.number().int().min(0).max(500).nullable().optional(),
      dietaryType: z.enum(['vegetarian', 'vegan', 'pescatarian']).nullable().optional(),
      allergens: z
        .array(
          z.enum([
            'gluten',
            'dairy',
            'eggs',
            'nuts',
            'peanuts',
            'soy',
            'fish',
            'shellfish',
            'sesame',
          ]),
        )
        .optional(),
      restrictions: z.array(z.string()).optional(),
      excludedIngredients: z.array(z.string()).optional(),
      excludedIngredientIds: z.array(z.string()).optional(),
    })
    .optional(),
})

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: memberId } = await params

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const householdMembership = await getHouseholdMembership(session.user.id)

    if (!householdMembership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    const member = await prisma.householdMember.findUnique({
      where: { id: memberId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
        preferences: true,
      },
    })

    if (!member || member.householdId !== householdMembership.householdId) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    return NextResponse.json({
      id: member.id,
      userId: member.userId,
      name: member.name,
      role: member.role,
      joinedAt: member.joinedAt,
      user: member.user,
      preferences: member.preferences
        ? {
            displayName: member.preferences.displayName,
            portionMultiplier: member.preferences.portionMultiplier,
            targetCalories: member.preferences.targetCalories,
            targetProtein: member.preferences.targetProtein,
            targetCarbs: member.preferences.targetCarbs,
            targetFat: member.preferences.targetFat,
            dietaryType: member.preferences.dietaryType,
            allergens: member.preferences.allergens,
            restrictions: member.preferences.restrictions,
            excludedIngredients: member.preferences.excludedIngredients,
            excludedIngredientIds: member.preferences.excludedIngredientIds,
          }
        : null,
    })
  } catch (error) {
    captureApiError(error, { route: '/api/households/me/members/[id]', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to fetch member' }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: memberId } = await params

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const householdMembership = await getHouseholdMembership(session.user.id)

    if (!householdMembership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    const member = await prisma.householdMember.findUnique({
      where: { id: memberId },
      include: { preferences: { select: { portionMultiplier: true } } },
    })

    if (!member || member.householdId !== householdMembership.householdId) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // Allow owner OR the member themselves to update
    const isOwner = householdMembership.role === 'owner'
    const isSelf = householdMembership.id === memberId
    if (!isOwner && !isSelf) {
      return NextResponse.json({ error: 'You can only edit your own preferences' }, { status: 403 })
    }

    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = updateMemberSchema.safeParse(body)

    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
    }

    const { name, preferences } = parsed.data

    // Only allow updating name for manual members (those without userId)
    if (name !== undefined && member.userId !== null) {
      return NextResponse.json({ error: 'Cannot update name for linked members' }, { status: 400 })
    }

    // A missing preferences row is the column default, 1×.
    const portionChanged =
      preferences?.portionMultiplier !== undefined &&
      preferences.portionMultiplier !== (member.preferences?.portionMultiplier ?? 1)

    const updatedMember = await prisma.$transaction(async (tx) => {
      // Update member name if provided and it's a manual member
      if (name !== undefined) {
        await tx.householdMember.update({
          where: { id: memberId },
          data: { name },
        })
      }

      // Update preferences if provided
      if (preferences) {
        await tx.memberPreferences.upsert({
          where: { memberId },
          create: {
            memberId,
            displayName: preferences.displayName,
            portionMultiplier: preferences.portionMultiplier,
            targetCalories: preferences.targetCalories,
            targetProtein: preferences.targetProtein,
            targetCarbs: preferences.targetCarbs,
            targetFat: preferences.targetFat,
            dietaryType: preferences.dietaryType,
            allergens: preferences.allergens,
            restrictions: preferences.restrictions,
            excludedIngredients: preferences.excludedIngredients,
            excludedIngredientIds: preferences.excludedIngredientIds,
          },
          update: {
            displayName: preferences.displayName,
            portionMultiplier: preferences.portionMultiplier,
            targetCalories: preferences.targetCalories,
            targetProtein: preferences.targetProtein,
            targetCarbs: preferences.targetCarbs,
            targetFat: preferences.targetFat,
            dietaryType: preferences.dietaryType,
            allergens: preferences.allergens,
            restrictions: preferences.restrictions,
            excludedIngredients: preferences.excludedIngredients,
            excludedIngredientIds: preferences.excludedIngredientIds,
          },
        })
      }

      // A portion size is summed into the household's servings, which price
      // the cached prep tips on every entry without a `servingOverride`
      // (HON-1040). Clear them only when those servings moved: the member
      // dialogs send `portionMultiplier` on every save, and the sum is rounded
      // to 0.5, so 1.5 + 0.75 and 1.5 + 1 both price 2.5. A needless
      // invalidation costs a paid regeneration per entry (HON-684).
      // `portionChanged` is the cheap guard that skips the re-read.
      if (
        portionChanged &&
        (await loadHouseholdServings(householdMembership.householdId, tx)) !==
          sumPortions(householdMembership.household.members)
      ) {
        await invalidateFutureEntryTips(
          tx,
          householdMembership.householdId,
          householdMembership.household.timezone,
        )
      }

      return tx.householdMember.findUnique({
        where: { id: memberId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          preferences: true,
        },
      })
    })

    return NextResponse.json({
      id: updatedMember!.id,
      userId: updatedMember!.userId,
      name: updatedMember!.name,
      role: updatedMember!.role,
      joinedAt: updatedMember!.joinedAt,
      user: updatedMember!.user,
      preferences: updatedMember!.preferences
        ? {
            displayName: updatedMember!.preferences.displayName,
            portionMultiplier: updatedMember!.preferences.portionMultiplier,
            targetCalories: updatedMember!.preferences.targetCalories,
            targetProtein: updatedMember!.preferences.targetProtein,
            targetCarbs: updatedMember!.preferences.targetCarbs,
            targetFat: updatedMember!.preferences.targetFat,
            dietaryType: updatedMember!.preferences.dietaryType,
            allergens: updatedMember!.preferences.allergens,
            restrictions: updatedMember!.preferences.restrictions,
            excludedIngredients: updatedMember!.preferences.excludedIngredients,
            excludedIngredientIds: updatedMember!.preferences.excludedIngredientIds,
          }
        : null,
    })
  } catch (error) {
    captureApiError(error, { route: '/api/households/me/members/[id]', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to update member' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: memberId } = await params

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const householdMembership = await getHouseholdMembership(session.user.id)

    if (!householdMembership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    // Only owners can delete members
    if (householdMembership.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only the household owner can remove members' },
        { status: 403 },
      )
    }

    const member = await prisma.householdMember.findUnique({
      where: { id: memberId },
    })

    if (!member || member.householdId !== householdMembership.householdId) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // Prevent owner from deleting themselves
    if (member.userId === session.user.id) {
      return NextResponse.json(
        { error: 'Cannot remove yourself from the household' },
        { status: 400 },
      )
    }

    // Prevent deleting the owner
    if (member.role === 'owner') {
      return NextResponse.json({ error: 'Cannot remove the household owner' }, { status: 400 })
    }

    await prisma.$transaction(async (tx) => {
      await tx.householdMember.delete({
        where: { id: memberId },
      })

      // Losing the member lowers the household's size, which prices the cached
      // prep-tips prompt on every entry without a `servingOverride` — the
      // default state — so the household's whole remaining plan is now scaled
      // for a larger household. Drop those tips in the same transaction as the
      // membership write and let the next open of the modal regenerate through
      // the existing rate-limited path. See `docs/LOCALIZATION.md` → "AI
      // surfaces (Tier 1)" (HON-684).
      await invalidateFutureEntryTips(
        tx,
        householdMembership.householdId,
        householdMembership.household.timezone,
      )
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    captureApiError(error, { route: '/api/households/me/members/[id]', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
  }
}
