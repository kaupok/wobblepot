import { prisma } from '@/lib/prisma'

/**
 * Get household membership for a user.
 * Returns null if user has no household membership.
 *
 * The member count rides along on `household._count.members`. Prisma folds a
 * relation `_count` into this same round-trip, so every caller that needs the
 * household size gets it without a second `household_member` read. This
 * replaced the former `getHouseholdMemberCount` helper outright (HON-596) —
 * all four of its callers already held the membership row, so keeping it would
 * have meant counting the same table twice per request.
 */
export async function getHouseholdMembership(userId: string) {
  return prisma.householdMember.findFirst({
    where: { userId },
    include: {
      household: {
        include: {
          preferences: true,
          _count: { select: { members: true } },
        },
      },
    },
  })
}

/**
 * Check if a user has any household membership.
 * Lightweight existence check (no data loaded).
 */
export async function hasHouseholdMembership(userId: string): Promise<boolean> {
  const count = await prisma.householdMember.count({
    where: { userId },
  })
  return count > 0
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
