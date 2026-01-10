import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'

export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const householdMembership = await getHouseholdMembership(session.user.id)

  if (!householdMembership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const { household } = householdMembership
  return NextResponse.json({
    id: household.id,
    name: household.name,
    timezone: household.timezone,
    createdAt: household.createdAt,
    preferences: household.preferences,
  })
}
