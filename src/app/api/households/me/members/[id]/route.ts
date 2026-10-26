import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import {
  getHouseholdMember,
  MemberChangeError,
  removeMember,
  updateMember,
  type MemberChangeRefusal,
} from '@/lib/household/members'

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

    const member = await getHouseholdMember(householdMembership.householdId, memberId)

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    return NextResponse.json(member)
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

    // Checks the member is in this household and the caller may edit them, and
    // clears the cached prep tips when the household's servings move (HON-1040).
    return NextResponse.json(await updateMember(householdMembership, memberId, parsed.data))
  } catch (error) {
    if (error instanceof MemberChangeError) return refusal(error.reason)
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

    // Refuses the owner's own row and the owner's, and clears the cached prep
    // tips the smaller household makes stale (HON-684).
    await removeMember(householdMembership, memberId)

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof MemberChangeError) return refusal(error.reason)
    captureApiError(error, { route: '/api/households/me/members/[id]', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
  }
}

/** The status and body each `MemberChangeError` reason maps to. */
const REFUSALS: Record<MemberChangeRefusal, { error: string; status: number }> = {
  notFound: { error: 'Member not found', status: 404 },
  notAllowed: { error: 'You can only edit your own preferences', status: 403 },
  linkedName: { error: 'Cannot update name for linked members', status: 400 },
  self: { error: 'Cannot remove yourself from the household', status: 400 },
  owner: { error: 'Cannot remove the household owner', status: 400 },
  // `addMember` alone raises it, behind `POST /api/households/me/members`.
  householdFull: { error: 'household_full', status: 400 },
}

function refusal(reason: MemberChangeRefusal) {
  const { error, status } = REFUSALS[reason]
  return NextResponse.json({ error }, { status })
}
