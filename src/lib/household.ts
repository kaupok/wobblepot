import { prisma, type PrismaClientType } from '@/lib/prisma'
import { getServerBaseURL } from '@/lib/env'
import { sumPortions } from '@/lib/meal-planning/servings'
import type { Locale } from '@/lib/i18n/locales'

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
 * Each member's portion size, in the shape `sumPortions` reads. It rides along
 * on the membership query for the same reason the member count does: every
 * site that scales a meal already holds the membership row (HON-1040).
 */
const PORTIONS_SELECT = {
  select: { preferences: { select: { portionMultiplier: true } } },
} as const

/**
 * Get household membership for a user.
 * Returns null if user has no household membership.
 *
 * The member count rides along on `household._count.members`, and each
 * member's portion size on `household.members` (pass them to `sumPortions` for
 * the household's servings, HON-1040). Prisma folds a relation `_count` into
 * this same round-trip, so every caller that needs the
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
          members: PORTIONS_SELECT,
        },
      },
    },
  })
}

/** The validated body of a household settings update. An absent key is left alone. */
export interface HouseholdPatch {
  name?: string
  timezone?: string
  locale?: Locale
}

/**
 * Save a household's settings, behind `PATCH /api/households/me`, and return
 * the household with its preferences. `household` is the stored row the
 * caller holds, so the locale it carries is the one being replaced.
 *
 * The household's locale is an input to every cached prep-tips generation
 * (`MealPlanEntry.preparationTips`), and `docs/LOCALIZATION.md` requires AI
 * caches not to survive a locale change. Nothing else clears them, and three
 * read sites serialise the stored value straight into the entry payload — so
 * a household that switches en → et would keep showing English tips
 * indefinitely. Drop them here and let the next open of the modal regenerate
 * through the existing rate-limited path (HON-681).
 *
 * Only when the locale actually moves: a name-only or timezone-only update, or
 * one that resends the stored locale, must not touch a single entry.
 */
export async function updateHousehold(
  household: { id: string; locale: string },
  patch: HouseholdPatch,
) {
  const updateArgs = {
    where: { id: household.id },
    data: patch,
    include: { preferences: true },
  }

  const localeChanged = patch.locale !== undefined && patch.locale !== household.locale
  if (!localeChanged) return prisma.household.update(updateArgs)

  return prisma.$transaction(async (tx) => {
    const updated = await tx.household.update(updateArgs)

    await tx.mealPlanEntry.updateMany({
      where: {
        plan: { householdId: household.id },
        preparationTips: { not: null },
      },
      data: { preparationTips: null },
    })

    return updated
  })
}

/**
 * A household's servings (`sumPortions`), read on its own, for the sites that
 * hold only a household id: the shopping list, and the prep-tips cache write
 * that re-checks the servings it priced from. Pass a transaction client to read
 * inside one.
 */
export async function loadHouseholdServings(
  householdId: string,
  client: Pick<PrismaClientType, 'householdMember'> = prisma,
): Promise<number> {
  const members = await client.householdMember.findMany({
    where: { householdId },
    ...PORTIONS_SELECT,
  })
  return sumPortions(members)
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
 * guard below, the dialog on `/account/data`, and `purgeUser`'s decision to delete
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
