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

/**
 * Check if user is the sole owner of a household that has other members.
 * Used to prevent account deletion that would orphan household members.
 */
export async function isUserSoleOwnerWithOtherMembers(userId: string): Promise<{
  isSoleOwner: boolean
  householdId?: string
  householdName?: string
  memberCount?: number
}> {
  // Find household where user is an owner
  const ownerMembership = await prisma.householdMember.findFirst({
    where: {
      userId,
      role: 'owner',
    },
    include: {
      household: true,
    },
  })

  if (!ownerMembership) {
    return { isSoleOwner: false }
  }

  // Count total members in the household
  const memberCount = await prisma.householdMember.count({
    where: { householdId: ownerMembership.householdId },
  })

  // If there are other members besides the user, they are sole owner with others
  if (memberCount > 1) {
    return {
      isSoleOwner: true,
      householdId: ownerMembership.householdId,
      householdName: ownerMembership.household.name,
      memberCount,
    }
  }

  return { isSoleOwner: false }
}
