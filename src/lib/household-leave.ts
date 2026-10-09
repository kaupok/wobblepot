import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { countAccountHoldingMembers } from '@/lib/household'
import { invalidateFutureEntrySteps } from '@/lib/meal-planning/preparation-steps-cache'
import { discardMealImage } from '@/lib/meal-images/storage'
import { getPosthogServer } from '@/lib/posthog-server'

/** The user has no household membership to leave. */
export class NotInHouseholdError extends Error {
  constructor() {
    super('You are not a member of a household')
    this.name = 'NotInHouseholdError'
  }
}

/**
 * The user owns a household that another account holder also belongs to.
 * Leaving would leave that person in a household with no owner, so the owner
 * removes the other accounts first. Same rule as account deletion
 * (`isUserSoleOwnerWithOtherMembers`). `otherAccountCount` excludes the owner.
 */
export class OwnerHasOtherAccountsError extends Error {
  constructor(readonly otherAccountCount: number) {
    super('The household owner cannot leave while other account holders remain')
    this.name = 'OwnerHasOtherAccountsError'
  }
}

export interface LeaveHouseholdResult {
  householdId: string
  role: 'owner' | 'member'
  /** True when the user was the owner and the only account holder. */
  deletedHousehold: boolean
  /**
   * Meal image blobs of a deleted household. The cascade drops the only
   * reference to each, so the caller deletes them after the transaction
   * commits ({@link discardLeftHouseholdImages}), as `purgeUser` does (HON-734).
   */
  imageUrls: string[]
}

/**
 * Takes the user out of their household (HON-1133). Run it on the transaction
 * of `runHouseholdClaim`, so it holds the same per-user lock a join does, and a
 * join that leaves first commits the leave and the claim together.
 *
 * - `member`: the member row is deleted; its invite and preferences cascade.
 *   The household stays, and its cached prep tips are dropped because the
 *   household got smaller (HON-684).
 * - `owner` and the only account holder: the household is deleted. The
 *   cascade takes its members without an account, plan, pantry, shopping
 *   items, recipes and preferences, the same branch `purgeUser` takes.
 * - `owner` with other account holders: {@link OwnerHasOtherAccountsError}.
 *
 * Throws {@link NotInHouseholdError} before any write when there is no
 * membership, so a caller can catch it without aborting the transaction.
 */
export async function leaveHousehold(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<LeaveHouseholdResult> {
  const membership = await tx.householdMember.findFirst({
    where: { userId },
    select: {
      id: true,
      householdId: true,
      role: true,
      household: { select: { timezone: true } },
    },
  })

  if (!membership) {
    throw new NotInHouseholdError()
  }

  const { householdId } = membership

  if (membership.role === 'owner') {
    const accountMemberCount = await countAccountHoldingMembers(householdId, tx)
    if (accountMemberCount > 1) {
      throw new OwnerHasOtherAccountsError(accountMemberCount - 1)
    }

    const imagedMeals = await tx.meal.findMany({
      where: { householdId, imageUrl: { not: null } },
      select: { imageUrl: true },
    })
    const imageUrls = imagedMeals.flatMap(({ imageUrl }) => (imageUrl ? [imageUrl] : []))

    await tx.household.delete({ where: { id: householdId } })

    return { householdId, role: 'owner', deletedHousehold: true, imageUrls }
  }

  await tx.householdMember.delete({ where: { id: membership.id } })
  await invalidateFutureEntrySteps(tx, householdId, membership.household.timezone)

  return { householdId, role: 'member', deletedHousehold: false, imageUrls: [] }
}

/**
 * The after-commit half of a leave: delete the left household's meal images
 * and record `household:member_left`. Call it only once the transaction that
 * ran {@link leaveHousehold} has committed, so a rolled-back leave keeps its
 * images and is not counted. Best-effort on both halves.
 */
export async function afterHouseholdLeft(result: LeaveHouseholdResult, route: string) {
  for (const url of result.imageUrls) {
    await discardMealImage(url, route)
  }

  // A server event, listed under "Server events" in `src/lib/analytics.ts`.
  // The distinct id is the household, as for the other server product event,
  // so no person profile is created for the user from here. Swallowed: the
  // leave has committed, so a failed capture must not turn it into a 500.
  try {
    getPosthogServer()?.capture({
      distinctId: result.householdId,
      event: 'household:member_left',
      properties: {
        household_id: result.householdId,
        role: result.role,
        deleted_household: result.deletedHousehold,
      },
    })
  } catch {
    // Analytics only.
  }
}
