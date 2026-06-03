import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isUserSoleOwnerWithOtherMembers } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { resend, isEmailConfigured, EMAIL_SENDERS, envSubject } from '@/lib/resend'
import { generateAccountDeletionRequestedEmail } from '@/lib/emails/account-deletion-requested'
import { PRIVACY_EMAIL } from '@/lib/support'

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
 * Sends the deletion-confirmation email. Best-effort: the soft-delete is
 * already committed by the time this runs, so a Resend failure is logged but
 * never thrown — we must not trap the user in a half-deleted state, and the
 * 30-day window still applies regardless of email delivery.
 */
async function sendDeletionConfirmationEmail(to: string, purgeDate: Date): Promise<void> {
  if (!isEmailConfigured() || !resend) {
    // eslint-disable-next-line no-console
    console.warn('Email not configured. Account-deletion confirmation not sent.')
    return
  }

  const { subject, ...rest } = generateAccountDeletionRequestedEmail({
    purgeDate,
    recoveryEmail: PRIVACY_EMAIL,
  })

  try {
    await resend.emails.send({
      from: EMAIL_SENDERS.auth,
      to,
      subject: envSubject(subject),
      ...rest,
    })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to send account-deletion confirmation email:', error)
  }
}

/**
 * DELETE /api/auth/user
 *
 * Requests deletion of the authenticated user's account (GDPR Art. 17).
 *
 * This is a soft-delete with a 30-day grace window, not an immediate purge:
 * - Sets `deletedAt` + `purgeScheduledFor` (now + 30 days) on the user.
 * - Invalidates all sessions (Better Auth signs the user out everywhere).
 * - Sends a confirmation email stating the purge date and how to cancel.
 *
 * Sign-in is blocked while `deletedAt` is set (see `src/lib/auth.ts`). The
 * actual hard cascade runs later via `purgeUser` from the daily cron
 * (`/api/cron/purge-deleted-users`). Recovery during the window is a manual
 * operator step — see `docs/RUNBOOKS/gdpr-deletion.md`.
 *
 * Returns 400 if the user is the sole owner of a household with other members
 * (they must transfer ownership first — unchanged behavior).
 */
export async function DELETE() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id
  const userEmail = session.user.email

  try {
    // Check if user is sole owner with other members (unchanged guard)
    const ownershipCheck = await isUserSoleOwnerWithOtherMembers(userId)

    if (ownershipCheck.isSoleOwner) {
      return NextResponse.json(
        {
          error: 'Cannot delete account',
          message: `You are the sole owner of "${ownershipCheck.householdName}" which has ${ownershipCheck.memberCount! - 1} other member(s). Please transfer ownership or remove other members first.`,
          householdId: ownershipCheck.householdId,
          householdName: ownershipCheck.householdName,
        },
        { status: 400 },
      )
    }

    const now = new Date()
    const purgeScheduledFor = computePurgeInstant(now)

    // Soft-delete: mark the account and sign the user out everywhere. Household
    // data and the user row are left intact until the grace window expires.
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { deletedAt: now, purgeScheduledFor },
      })

      await tx.session.deleteMany({
        where: { userId },
      })
    })

    // Confirmation email is sent after the soft-delete commits (best-effort).
    await sendDeletionConfirmationEmail(userEmail, purgeScheduledFor)

    return NextResponse.json({ success: true, purgeScheduledFor })
  } catch (error) {
    captureApiError(error, { route: '/api/auth/user', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
  }
}
