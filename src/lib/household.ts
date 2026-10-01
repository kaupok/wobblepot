import { prisma, type PrismaClientType } from '@/lib/prisma'
import { getServerBaseURL } from '@/lib/env'

/**
 * Most members, owner included, a household can hold. `POST /api/households`
 * bounds one onboarding payload at 20 members plus the owner (HON-698); this is
 * the household-size invariant that `POST /api/households/me/members` enforces
 * on every later add (HON-720). It sits above the 21 onboarding can produce, so
 * a household created at that bound can still add members, and far above any
 * real household.
 */
export const MAX_HOUSEHOLD_MEMBERS = 30

/**
 * Get household membership for a user.
 * Returns null if user has no household membership.
 *
 * The member count rides along on `household._count.members`. Prisma folds a
 * relation `_count` into this same round-trip, so every caller that needs the
 * household size gets it without a second `household_member` read. This
 * replaced the former `getHouseholdMemberCount` helper outright (HON-596).
 * Every site that needed a household size already held the membership row — the
 * five that went through the helper plus `GET /api/pantry`, which counted via
 * `prisma.householdMember.count` directly — so keeping it would have meant
 * counting the same table twice per request.
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
 * List a household's members in the shape `GET /api/households/me/members`
 * returns. The route and the `/household` server prefetch both read through
 * this, so the hydrated cache and a client refetch cannot drift (HON-780).
 */
export async function listHouseholdMembers(householdId: string) {
  const members = await prisma.householdMember.findMany({
    where: { householdId },
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
      invite: true,
    },
    orderBy: { joinedAt: 'asc' },
  })

  const baseUrl = getServerBaseURL()
  const now = new Date()

  return members.map((member) => {
    // Compute invite status
    let invite = null
    if (member.invite) {
      // Expiry alone: an invite that still has a row has not been used,
      // because claiming one deletes it (HON-680).
      const isExpired = member.invite.expiresAt < now
      invite = {
        url: `${baseUrl}/invite/${member.invite.code}`,
        expiresAt: member.invite.expiresAt.toISOString(),
        isActive: !isExpired,
      }
    }

    return {
      id: member.id,
      userId: member.userId,
      name: member.name,
      role: member.role,
      joinedAt: member.joinedAt,
      user: member.user,
      preferences: member.preferences
        ? {
            displayName: member.preferences.displayName,
            portionMultiplier: member.preferences.portionMultiplier,
            targetCalories: member.preferences.targetCalories,
            targetProtein: member.preferences.targetProtein,
            targetCarbs: member.preferences.targetCarbs,
            targetFat: member.preferences.targetFat,
            dietaryType: member.preferences.dietaryType,
            allergens: member.preferences.allergens,
            restrictions: member.preferences.restrictions,
            excludedIngredients: member.preferences.excludedIngredients,
          }
        : null,
      invite,
    }
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
 * Count a household's members that have their own account (`userId` set).
 *
 * Manual members — people the owner added by name, typically children — have
 * no account and are data the owner entered, not other people with a stake in
 * the household. This is the count account deletion turns on: the sole-owner
 * guard below, the dialog on `/profile`, and `purgeUser`'s decision to delete
 * the household (HON-881). `db` lets the purge run it on its transaction.
 */
export async function countAccountHoldingMembers(
  householdId: string,
  db: Pick<PrismaClientType, 'householdMember'> = prisma,
): Promise<number> {
  return db.householdMember.count({
    where: { householdId, userId: { not: null } },
  })
}

/**
 * Check if user is the sole owner of a household that another account holder
 * also belongs to. Used to block account deletion that would leave that
 * member in a household with no owner.
 *
 * Only members with an account count (`countAccountHoldingMembers`): manual
 * members do not block the owner, and `purgeUser` deletes them with the
 * household (HON-881). `memberCount` is that same count, owner included, so
 * `memberCount - 1` is the number of *other* account-holding members.
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

  const memberCount = await countAccountHoldingMembers(ownerMembership.householdId)

  // Another account holder besides the owner would be left without one
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
