import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'

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

  const members = await prisma.householdMember.findMany({
    where: { householdId: householdMembership.householdId },
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
    orderBy: { joinedAt: 'asc' },
  })

  return NextResponse.json({
    householdId: householdMembership.householdId,
    members: members.map((member) => ({
      id: member.id,
      userId: member.userId,
      role: member.role,
      joinedAt: member.joinedAt,
      user: member.user,
      preferences: member.preferences
        ? {
            displayName: member.preferences.displayName,
            portionMultiplier: member.preferences.portionMultiplier,
            dietaryType: member.preferences.dietaryType,
            restrictions: member.preferences.restrictions,
          }
        : null,
    })),
  })
}
