import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { getMonthBoundaries, getMonthSpendUsd } from '@/lib/ai/usage'

export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const { household } = membership
  const spendUsd = await getMonthSpendUsd(household.id)
  const capUsd = Number(household.aiCapUsd)
  const percentage = capUsd > 0 ? (spendUsd / capUsd) * 100 : 0
  const { end } = getMonthBoundaries(household.timezone)

  return NextResponse.json({
    spendUsd,
    capUsd,
    percentage,
    resetAt: end.toISOString(),
  })
}
