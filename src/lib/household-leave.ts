import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { countAccountHoldingMembers } from '@/lib/household'
import { invalidateFutureEntrySteps } from '@/lib/meal-planning/preparation-steps-cache'
import { discardMealImage } from '@/lib/meal-images/storage'
import { getPosthogServer } from '@/lib/posthog-server'
import { deletePosthogPersons } from '@/lib/posthog-purge'
import { captureApiError } from '@/lib/errors'

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
    // Lock the household before counting, so an invite claim into it either
    // committed already (and is counted) or waits and then finds its member
    // row gone. The claim holds `FOR KEY SHARE` on this row for the same
    // reason (`inviteMembershipClaim`).
    await tx.$queryRaw`SELECT 1 FROM "household" WHERE "id" = ${householdId} FOR UPDATE`
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
 * The after-commit half of a leave. Call it only once the transaction that ran
 * {@link leaveHousehold} has committed, so a rolled-back leave keeps its
 * images and analytics and is not counted. Never throws: the leave has
 * committed, so nothing here may turn it into an error response.
 *
 * - Deletes the meal images of a deleted household.
 * - Erases a deleted household's PostHog person and events, as `purgeUser`
 *   does: AI usage events attribute to the household id, and once the row is
 *   gone nothing in the database links them to anyone, so a later account
 *   deletion could not find them. Best-effort here rather than before the
 *   transaction as in the purge, so PostHog being down does not block a
 *   leave; a failure is captured with the household id for the hand sweep in
 *   `docs/RUNBOOKS/gdpr-deletion.md`.
 * - Records `household:member_left`.
 */
export async function afterHouseholdLeft(
  result: LeaveHouseholdResult,
  context: { route: string; userId: string },
) {
  for (const url of result.imageUrls) {
    await discardMealImage(url, context.route)
  }

  if (result.deletedHousehold) {
    try {
      await deletePosthogPersons([result.householdId], { userId: context.userId })
    } catch (error) {
      captureApiError(error, {
        route: context.route,
        userId: context.userId,
        operation: 'posthog-household-purge',
        distinctIds: [result.householdId],
      })
    }
  }

  // A server event, listed under "Server events" in `src/lib/analytics.ts`.
  // The distinct id is the household, as for the other server product event,
  // and the event is personless, so it creates no person profile: in
  // particular none for a household whose person was just erased above.
  try {
    getPosthogServer()?.capture({
      distinctId: result.householdId,
      event: 'household:member_left',
      properties: {
        household_id: result.householdId,
        role: result.role,
        deleted_household: result.deletedHousehold,
        $process_person_profile: false,
      },
    })
  } catch {
    // Analytics only.
  }
}
