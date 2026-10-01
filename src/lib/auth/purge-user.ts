import { prisma, type PrismaClientType } from '@/lib/prisma'
import { invalidateFutureEntryTips } from '@/lib/meal-planning/preparation-tips-cache'
import { discardMealImage } from '@/lib/meal-images/storage'
import { countAccountHoldingMembers } from '@/lib/household'
import { deletePosthogPersons } from '@/lib/posthog-purge'

/**
 * Hard-deletes a user and every record that should not outlive their account.
 *
 * Extracted from the original `DELETE /api/auth/user` cascade (HON-481) so it
 * can be shared: the delete route now soft-deletes (sets `deletedAt` +
 * `purgeScheduledFor`), and the daily purge cron
 * (`/api/cron/purge-deleted-users`) calls this helper once the 30-day grace
 * window has elapsed.
 *
 * Cascade summary (full per-model map: `docs/RUNBOOKS/gdpr-deletion.md`):
 * - Household where the user is the owner and the only member with an
 *   account → deleted; Prisma `onDelete: Cascade` removes its manual members
 *   (the owner-entered rows with no account, typically children, and their
 *   preferences), invites, meals, plans, pantry, favorites, custom shopping
 *   items, household-scoped ingredients, and AI usage. Manual members do not
 *   keep the household alive: nobody could reach their data once the owner is
 *   gone (HON-881). Its meals' generated images live in Vercel Blob, outside
 *   the database, so they are deleted after the transaction commits (HON-734).
 * - Household where the user is a non-owner member → only the membership is
 *   removed; shared household data is left intact for the remaining members,
 *   except that the cached prep tips on its forward-looking entries are
 *   dropped — the smaller household re-prices them (HON-684).
 * - Sessions and accounts (Better Auth) → deleted.
 * - The `user` row → deleted (cascades sessions/accounts/memberships again as a
 *   backstop; `SignupCode` links are set null to preserve the audit trail).
 * - PostHog → the person and events for the user id, and for the id of each
 *   household this purge deletes (AI usage events attribute to it), are
 *   deleted before the transaction (HON-907). A failed call throws, so the
 *   user row stays and the next nightly run retries; an unset purge key skips
 *   with a captured error (`deletePosthogPersons`).
 *
 * Runs in a single transaction so a partial cascade can never leave an
 * orphaned account behind. The cron calls this once per expired user, so each
 * purge is isolated — one failure does not roll back the others.
 *
 * **Forward-compat:** when a new model stores user-owned or user-linked data
 * (e.g. HON-453's per-user AI records), add it here AND to the runbook cascade
 * table in the same PR. The same goes for a new store outside the database
 * that keeps data keyed by the user or household id: delete it here and add
 * it to the runbook's "Data held outside the database" table.
 */
export async function purgeUser(userId: string, db: PrismaClientType = prisma): Promise<void> {
  // PostHog first: a failed delete must leave the user row in place so the
  // next run retries, which it cannot do once the transaction has committed.
  // This read only decides which household ids to send; the transaction below
  // re-runs the same check and stays the authority on what it deletes.
  const ownedMemberships = await db.householdMember.findMany({
    where: { userId, role: 'owner' },
    select: { householdId: true },
  })
  const householdIdsToDelete: string[] = []
  for (const { householdId } of ownedMemberships) {
    if ((await countAccountHoldingMembers(householdId, db)) === 1) {
      householdIdsToDelete.push(householdId)
    }
  }
  await deletePosthogPersons([userId, ...householdIdsToDelete], { userId })

  const imageUrls = await db.$transaction(async (tx) => {
    const imageUrls: string[] = []

    // Find all household memberships for this user
    const memberships = await tx.householdMember.findMany({
      where: { userId },
      // `household.timezone` is only needed on the branches that leave the
      // household standing, where it bounds the prep-tips invalidation to
      // today onwards (HON-684). Read here rather than in those branches so
      // the transaction issues one query instead of one per membership.
      select: {
        id: true,
        householdId: true,
        role: true,
        household: { select: { timezone: true } },
      },
    })

    for (const membership of memberships) {
      // If the user is the owner and the only member with an account, delete
      // the entire household. The cascade takes its manual members with it, as
      // well as preferences, invites, pantry items and meal plans (HON-881).
      if (membership.role === 'owner') {
        const accountMemberCount = await countAccountHoldingMembers(membership.householdId, tx)

        if (accountMemberCount === 1) {
          // The cascade drops these rows and, with them, the only reference
          // to each image blob — collect the URLs first so the files do not
          // outlive the erasure at a public URL nothing can find again.
          const imagedMeals = await tx.meal.findMany({
            where: { householdId: membership.householdId, imageUrl: { not: null } },
            select: { imageUrl: true },
          })
          for (const { imageUrl } of imagedMeals) if (imageUrl) imageUrls.push(imageUrl)

          // Delete household (cascade handles related records)
          await tx.household.delete({
            where: { id: membership.householdId },
          })
        } else {
          // Another account holder remains. The sole-owner guard at request
          // time and the join route's pending-deletion check should prevent
          // this, but handle gracefully: drop the membership, leave the
          // household.
          await tx.householdMember.delete({
            where: { id: membership.id },
          })
          await invalidateFutureEntryTips(tx, membership.householdId, membership.household.timezone)
        }
      } else {
        // Just remove the membership
        await tx.householdMember.delete({
          where: { id: membership.id },
        })
        // The household outlives this purge, and losing a member re-prices the
        // cached prep tips on every entry without a `servingOverride` — the
        // default state. Same defect and same fix as the two member routes; not
        // needed on the sole-owner branch above, where the household row is
        // deleted and `onDelete: Cascade` takes its plans and entries with it
        // (HON-684).
        await invalidateFutureEntryTips(tx, membership.householdId, membership.household.timezone)
      }
    }

    // Delete sessions (Better Auth)
    await tx.session.deleteMany({
      where: { userId },
    })

    // Delete accounts (Better Auth)
    await tx.account.deleteMany({
      where: { userId },
    })

    // Delete user (cascades handled by schema onDelete: Cascade where configured)
    await tx.user.delete({
      where: { id: userId },
    })

    return imageUrls
  })

  // After commit, so a rolled-back purge keeps its images. Best-effort: a
  // failed delete is reported and swallowed rather than failing the purge.
  for (const url of imageUrls) {
    await discardMealImage(url, '/api/cron/purge-deleted-users')
  }
}
