import 'server-only'
import { prisma } from '@/lib/prisma'
import { isUserSoleOwnerWithOtherMembers } from '@/lib/household'

/**
 * The account deletion request behind `DELETE /api/auth/user` (GDPR Art. 17,
 * HON-1216). The route owns the session, the confirmation email and the status
 * map; this module owns the household hand-off check and the soft-delete, and
 * is tested against a database in `account.db.test.ts`.
 *
 * There is no reversal function: recovery during the grace window is an
 * operator SQL step (`docs/RUNBOOKS/gdpr-deletion.md` → Recovery procedure),
 * and `account.db.test.ts` runs that SQL against the rows this writes.
 */

/** GDPR Art. 17 grace window: days between a deletion request and the hard purge. */
const GRACE_WINDOW_DAYS = 30

/**
 * UTC hour the purge cron runs. MUST match the schedule in `vercel.json`
 * (`"0 3 * * *"`). Used to align `purgeScheduledFor` to the actual cron run so
 * the confirmation email's date is the real deletion date, not an estimate.
 */
const PURGE_CRON_UTC_HOUR = 3

/**
 * The instant the account will actually be hard-deleted: the first cron run
 * (PURGE_CRON_UTC_HOUR:00 UTC) strictly after `now + 30 days`.
 *
 * Aligning to the cron run instead of using a bare `now + 30 days` means:
 * - the user always gets at least the full 30-day grace window (we never purge
 *   early — deletion is irreversible, so we err toward keeping data),
 * - the date in the confirmation email/toast is the real deletion date,
 * - retention is therefore 30 days plus up to one cron interval (≤24h). That
 *   bounded overage is the deliberate trade-off for the recovery guarantee;
 *   see docs/RUNBOOKS/gdpr-deletion.md.
 */
function computePurgeInstant(now: Date): Date {
  const earliest = new Date(now.getTime() + GRACE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const purge = new Date(earliest)
  purge.setUTCHours(PURGE_CRON_UTC_HOUR, 0, 0, 0)
  if (purge <= earliest) {
    purge.setUTCDate(purge.getUTCDate() + 1)
  }
  return purge
}

/**
 * Why a deletion request was refused. The route maps each one to its status:
 *
 * - `soleOwner`: the user owns a household where another member has an
 *   account, so deleting would strand them (400). Members without an account
 *   do not count: `purgeUser` deletes them with the household (HON-881).
 */
export type AccountDeletionRefusal = 'soleOwner'

export class AccountDeletionError extends Error {
  constructor(
    readonly reason: AccountDeletionRefusal,
    readonly household: { id: string; name: string; otherMemberCount: number },
  ) {
    super(`Account deletion refused: ${reason}`)
    this.name = 'AccountDeletionError'
  }
}

/**
 * Soft-deletes the account: sets `deletedAt` and a cron-aligned
 * `purgeScheduledFor`, signs the user out everywhere, and revokes connected
 * apps and API keys. Household data and the user row stay until the daily
 * cron purges them (`purgeUser`). Sign-in is blocked while `deletedAt` is set
 * (`assertUserNotSoftDeleted`).
 */
export async function requestAccountDeletion(
  userId: string,
  now: Date = new Date(),
): Promise<{ purgeScheduledFor: Date }> {
  const ownership = await isUserSoleOwnerWithOtherMembers(userId)
  if (ownership.isSoleOwner) {
    throw new AccountDeletionError('soleOwner', {
      id: ownership.householdId!,
      name: ownership.householdName!,
      otherMemberCount: ownership.memberCount! - 1,
    })
  }

  const purgeScheduledFor = computePurgeInstant(now)

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { deletedAt: now, purgeScheduledFor },
    })

    await tx.session.deleteMany({
      where: { userId },
    })

    // Connected MCP clients lose access with the sessions (HON-1150). The
    // token endpoint never creates a session, so the soft-delete guard on
    // session creation does not stop a refresh; deleting the grants does.
    // A JWT access token already issued stays valid until it expires (at
    // most an hour). The purge cascade would remove these rows too, but only
    // after the 30-day grace window.
    await tx.oauthRefreshToken.deleteMany({ where: { userId } })
    await tx.oauthAccessToken.deleteMany({ where: { userId } })
    await tx.oauthConsent.deleteMany({ where: { userId } })
    // Read-only API keys stop working at once too (HON-1220). The v1 routes
    // also refuse a key whose user has `deletedAt` set.
    await tx.apiKey.deleteMany({ where: { userId } })
  })

  return { purgeScheduledFor }
}
