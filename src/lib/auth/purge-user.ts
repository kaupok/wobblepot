import { prisma, type PrismaClientType } from '@/lib/prisma'
import { invalidateFutureEntryTips } from '@/lib/meal-planning/preparation-tips-cache'

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
 * - Household where the user is owner-and-only-member → deleted; Prisma
 *   `onDelete: Cascade` removes its preferences, invites, meals, plans, pantry,
 *   favorites, custom shopping items, household-scoped ingredients, and AI usage.
 * - Household where the user is a non-owner member → only the membership is
 *   removed; shared household data is left intact for the remaining members,
 *   except that the cached prep tips on its forward-looking entries are
 *   dropped — the smaller household re-prices them (HON-684).
 * - Sessions and accounts (Better Auth) → deleted.
 * - The `user` row → deleted (cascades sessions/accounts/memberships again as a
 *   backstop; `SignupCode` links are set null to preserve the audit trail).
 *
 * Runs in a single transaction so a partial cascade can never leave an
 * orphaned account behind. The cron calls this once per expired user, so each
 * purge is isolated — one failure does not roll back the others.
 *
 * **Forward-compat:** when a new model stores user-owned or user-linked data
 * (e.g. HON-453's per-user AI records), add it here AND to the runbook cascade
 * table in the same PR.
 */
export async function purgeUser(userId: string, db: PrismaClientType = prisma): Promise<void> {
  await db.$transaction(async (tx) => {
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
      // If user is owner and only member, delete the entire household
      // (cascade will handle household preferences, invites, pantry items, meal plans)
      if (membership.role === 'owner') {
        const memberCount = await tx.householdMember.count({
          where: { householdId: membership.householdId },
        })

        if (memberCount === 1) {
          // Delete household (cascade handles related records)
          await tx.household.delete({
            where: { id: membership.householdId },
          })
        } else {
          // This shouldn't happen due to the sole-owner guard at request time,
          // but handle gracefully: drop the membership, leave the household.
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
  })
}
