import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { MAX_HOUSEHOLD_MEMBERS, getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { addMember, listHouseholdMembers, MemberChangeError } from '@/lib/household/members'

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

    // Locks the household row, counts against the cap, and clears the cached
    // prep tips the new member's portion makes stale (HON-720, HON-684).
    const member = await addMember(householdMembership, parsed.data)

    return NextResponse.json(member, { status: 201 })
  } catch (error) {
    // Checked before `captureApiError`: a full household is an expected client
    // error, not a server fault. The throw rolled the transaction back, so
    // nothing was written. `code` is what `AddMemberDialog` localizes from.
    if (error instanceof MemberChangeError && error.reason === 'householdFull') {
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
