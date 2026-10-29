import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import type { AccountDeletionErrorCode } from '@/lib/account-deletion-error-codes'
import { auth } from '@/lib/auth'
import { AccountDeletionError, requestAccountDeletion } from '@/lib/auth/account'
import { generateAccountDeletionRequestedEmail } from '@/lib/emails/account-deletion-requested'
import { resolveEmailLocale } from '@/lib/emails/locale'
import { captureApiError } from '@/lib/errors'
import { EMAIL_SENDERS, envSubject, isEmailConfigured, resend } from '@/lib/resend'
import { PRIVACY_EMAIL } from '@/lib/support'

/**
 * Sends the deletion-confirmation email. Best-effort: the soft-delete is
 * already committed by the time this runs, so a Resend failure is logged but
 * never thrown — we must not trap the user in a half-deleted state, and the
 * 30-day window still applies regardless of email delivery.
 */
async function sendDeletionConfirmationEmail(
  userId: string,
  to: string,
  purgeDate: Date,
): Promise<void> {
  if (!isEmailConfigured() || !resend) {
    // eslint-disable-next-line no-console
    console.warn('Email not configured. Account-deletion confirmation not sent.')
    return
  }

  // Household locale, validated against PUBLIC_LOCALES, falling back to `en`
  // for a user with no household (HON-513).
  const locale = await resolveEmailLocale(userId)

  const { subject, ...rest } = generateAccountDeletionRequestedEmail({
    purgeDate,
    recoveryEmail: PRIVACY_EMAIL,
    locale,
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
 * The check and the soft-delete live in `requestAccountDeletion`
 * (`@/lib/auth/account`); this route owns the session, the email and the
 * status map. Sign-in is blocked while `deletedAt` is set (see `src/lib/auth.ts`). The
 * actual hard cascade runs later via `purgeUser` from the daily cron
 * (`/api/cron/purge-deleted-users`). Recovery during the window is a manual
 * operator step — see `docs/RUNBOOKS/gdpr-deletion.md`.
 *
 * Returns 400 if the user is the sole owner of a household that another member
 * with an account belongs to (they must remove the other members first).
 * Members without an account do not block: `purgeUser` deletes them with the
 * household (HON-881).
 *
 * Every error body carries a `code` from `AccountDeletionErrorCode` (HON-725);
 * `DeleteAccountDialog` translates that, never the English `message`. The
 * sole-owner branch also sends `otherMemberCount` — the other members with an
 * account — so the client can interpolate it rather than parse it out of prose.
 */
export async function DELETE() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    const code: AccountDeletionErrorCode = 'unauthorized'
    return NextResponse.json({ code, error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id
  const userEmail = session.user.email

  try {
    const { purgeScheduledFor } = await requestAccountDeletion(userId)

    // Confirmation email is sent after the soft-delete commits (best-effort).
    await sendDeletionConfirmationEmail(userId, userEmail, purgeScheduledFor)

    return NextResponse.json({ success: true, purgeScheduledFor })
  } catch (error) {
    if (error instanceof AccountDeletionError) {
      const code: AccountDeletionErrorCode = 'sole_owner'
      const { id, name, otherMemberCount } = error.household
      return NextResponse.json(
        {
          code,
          error: 'Cannot delete account',
          message: `You are the sole owner of "${name}" which has ${otherMemberCount} other member(s). Please remove the other members first.`,
          householdId: id,
          householdName: name,
          otherMemberCount,
        },
        { status: 400 },
      )
    }
    captureApiError(error, { route: '/api/auth/user', userId: session.user.id })
    const code: AccountDeletionErrorCode = 'delete_failed'
    return NextResponse.json({ code, error: 'Failed to delete account' }, { status: 500 })
  }
}
