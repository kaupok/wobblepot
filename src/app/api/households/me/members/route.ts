import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import {
  MAX_HOUSEHOLD_MEMBERS,
  getHouseholdMembership,
  listHouseholdMembers,
} from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { captureApiError } from '@/lib/errors'
import { invalidateFutureEntrySteps } from '@/lib/meal-planning/preparation-steps-cache'

const createManualMemberSchema = z.object({
  name: z.string().min(1).max(100),
  preferences: z
    .object({
      displayName: z.string().max(50).nullable().optional(),
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

/**
 * Thrown inside the add transaction when the household already holds
 * `MAX_HOUSEHOLD_MEMBERS`. A sentinel class rather than a string-matched
 * `Error` message, so the catch below cannot misread it and turn the 400 the
 * client branches on into a 500 (HON-679).
 */
class HouseholdFullError extends Error {
  constructor() {
    super('household_full')
    this.name = 'HouseholdFullError'
  }
}

export async function GET() {
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

    return NextResponse.json({
      householdId: householdMembership.householdId,
      members: await listHouseholdMembers(householdMembership.householdId),
    })
  } catch (error) {
    captureApiError(error, { route: '/api/households/me/members', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 })
  }
}

export async function POST(request: Request) {
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

    // Only owners can add manual members
    if (householdMembership.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only the household owner can add members' },
        { status: 403 },
      )
    }

    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = createManualMemberSchema.safeParse(body)

    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
    }

    const { name, preferences } = parsed.data

    // Create the manual member with preferences in a transaction
    const member = await prisma.$transaction(async (tx) => {
      // Lock the household row before counting (HON-720). At read committed a
      // plain count takes no lock, so two concurrent adds at 29 members would
      // both read 29 and both insert. The lock queues every add to this
      // household behind the last one, and because read committed takes a
      // fresh snapshot per statement, the second add's count then sees the
      // first add's committed row. `FOR NO KEY UPDATE`, not `FOR UPDATE`: it
      // does not conflict with the `FOR KEY SHARE` the member insert's foreign
      // key check takes on this row — the same choice as `lockUserForClaim`.
      await tx.$queryRaw`SELECT 1 FROM "household" WHERE "id" = ${householdMembership.householdId} FOR NO KEY UPDATE`

      const memberCount = await tx.householdMember.count({
        where: { householdId: householdMembership.householdId },
      })
      if (memberCount >= MAX_HOUSEHOLD_MEMBERS) {
        throw new HouseholdFullError()
      }

      const newMember = await tx.householdMember.create({
        data: {
          householdId: householdMembership.householdId,
          name,
          role: 'member', // Manual members are always regular members
        },
      })

      if (preferences) {
        await tx.memberPreferences.create({
          data: {
            memberId: newMember.id,
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

      // The new member raises the household's size, which prices the cached
      // prep-tips prompt on every entry without a `servingOverride` — the
      // default state — so the household's whole remaining plan is now scaled
      // for a smaller household. Drop those tips in the same transaction as
      // the membership write and let the next open of the modal regenerate
      // through the existing rate-limited path. See
      // `docs/LOCALIZATION.md` → "AI surfaces (Tier 1)" (HON-684).
      await invalidateFutureEntrySteps(
        tx,
        householdMembership.householdId,
        householdMembership.household.timezone,
      )

      return tx.householdMember.findUnique({
        where: { id: newMember.id },
        include: {
          preferences: true,
        },
      })
    })

    return NextResponse.json(
      {
        id: member!.id,
        userId: member!.userId,
        name: member!.name,
        role: member!.role,
        joinedAt: member!.joinedAt,
        user: null,
        preferences: member!.preferences
          ? {
              displayName: member!.preferences.displayName,
              portionMultiplier: member!.preferences.portionMultiplier,
              targetCalories: member!.preferences.targetCalories,
              targetProtein: member!.preferences.targetProtein,
              targetCarbs: member!.preferences.targetCarbs,
              targetFat: member!.preferences.targetFat,
              dietaryType: member!.preferences.dietaryType,
              allergens: member!.preferences.allergens,
              restrictions: member!.preferences.restrictions,
              excludedIngredients: member!.preferences.excludedIngredients,
            }
          : null,
        invite: null,
      },
      { status: 201 },
    )
  } catch (error) {
    // Checked before `captureApiError`: a full household is an expected client
    // error, not a server fault. The throw rolled the transaction back, so
    // nothing was written. `code` is what `AddMemberDialog` localizes from.
    if (error instanceof HouseholdFullError) {
      return NextResponse.json(
        {
          error: 'household_full',
          code: 'household_full',
          message: `This household has reached the limit of ${MAX_HOUSEHOLD_MEMBERS} members.`,
          limit: MAX_HOUSEHOLD_MEMBERS,
        },
        { status: 400 },
      )
    }

    captureApiError(error, { route: '/api/households/me/members', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to add member' }, { status: 500 })
  }
}
