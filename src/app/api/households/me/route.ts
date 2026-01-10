import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth, createHouseholdForUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let householdMembership = await prisma.householdMember.findFirst({
    where: { userId: session.user.id },
    include: {
      household: {
        include: { preferences: true },
      },
    },
  })

  // Self-healing: create household if none exists (handles legacy users)
  if (!householdMembership) {
    await createHouseholdForUser(session.user.id, session.user.name)
    householdMembership = await prisma.householdMember.findFirst({
      where: { userId: session.user.id },
      include: {
        household: {
          include: { preferences: true },
        },
      },
    })
  }

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
