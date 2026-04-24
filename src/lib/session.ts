import { cache } from 'react'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { hasHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }))

export const getHasHousehold = cache(async (userId: string) => hasHouseholdMembership(userId))

export const getHouseholdIdForUser = cache(async (userId: string): Promise<string | null> => {
  const membership = await prisma.householdMember.findFirst({
    where: { userId },
    select: { householdId: true },
  })
  return membership?.householdId ?? null
})
