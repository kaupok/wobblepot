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

/**
 * Get the number of members in a household.
 * Used for scaling meal quantities.
 */
export async function getHouseholdMemberCount(householdId: string): Promise<number> {
  return prisma.householdMember.count({
    where: { householdId },
  })
}
