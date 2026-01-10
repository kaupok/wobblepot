import { prisma } from '@/lib/prisma'

/**
 * Get household membership for a user.
 * Returns null if user has no household membership.
 */
export async function getHouseholdMembership(userId: string) {
  return prisma.householdMember.findFirst({
    where: { userId },
    include: {
      household: {
        include: { preferences: true },
      },
    },
  })
}
