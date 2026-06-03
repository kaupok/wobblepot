import { serverEnv } from '@/lib/env'
import { LEGAL_ENTITY_NAME } from '@/lib/support'

/**
 * Account Deletion Requested Email Template (GDPR Art. 17)
 *
 * Sent when a user requests account deletion. The account is soft-deleted
 * immediately (sign-out everywhere, sign-in blocked) and hard-purged after a
 * 30-day grace window by the daily cron. This email confirms the request,
 * states the exact purge date, and explains how to cancel within the window.
 *
 * Brand split (CLAUDE.md): the subject + body use the user-facing brand
 * (`NEXT_PUBLIC_APP_NAME` → Wobblepot); the legal entity (Honkadori OÜ) appears
 * only in the sign-off footer as the data-controller attribution.
 *
 * Inline HTML with email-safe styles + a plain-text fallback, mirroring
 * `reset-password.ts`.
 */

interface AccountDeletionRequestedEmailOptions {
  /** When the account is hard-deleted — the cron-aligned purge instant. */
  purgeDate: Date
  /** Address the user emails to cancel deletion within the grace window. */
  recoveryEmail: string
}

interface EmailContent {
  subject: string
  html: string
  text: string
}

/**
 * Formats the purge date deterministically in UTC. `purgeScheduledFor` is a UTC
 * timestamp and the purge cron runs at 03:00 UTC, so a fixed UTC, locale-stable
 * format (e.g. "5 July 2026") avoids server-timezone drift between the email
 * copy and the actual purge.
 */
function formatPurgeDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/**
 * Generates account-deletion-requested email content.
 *
 * @param options - the purge date and the recovery (cancellation) email
 * @returns Object with subject, html, and text content
 */
export function generateAccountDeletionRequestedEmail(
  options: AccountDeletionRequestedEmailOptions,
): EmailContent {
  const { purgeDate, recoveryEmail } = options
  const appName = serverEnv.NEXT_PUBLIC_APP_NAME
  const formattedDate = formatPurgeDate(purgeDate)
  const cancelHref = `mailto:${recoveryEmail}?subject=${encodeURIComponent('Cancel account deletion')}`

  const subject = `Your ${appName} account will be deleted on ${formattedDate}`

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 24px; font-size: 24px; font-weight: 600; color: #18181b;">
                Account deletion scheduled
              </h1>
              <p style="margin: 0 0 24px; font-size: 16px; line-height: 24px; color: #3f3f46;">
                We received a request to delete your ${appName} account. Your account has been deactivated and you've been signed out on all devices.
              </p>
              <p style="margin: 0 0 32px; font-size: 16px; line-height: 24px; color: #3f3f46;">
                Your account and all associated data are scheduled to be permanently deleted on <strong>${formattedDate}</strong>, 30 days from now.
              </p>
              <h2 style="margin: 0 0 12px; font-size: 18px; font-weight: 600; color: #18181b;">
                Changed your mind?
              </h2>
              <p style="margin: 0 0 32px; font-size: 16px; line-height: 24px; color: #3f3f46;">
                You can cancel the deletion and restore your account any time before that date by emailing us. After ${formattedDate}, your data cannot be recovered.
              </p>
              <table role="presentation" style="margin: 0 0 32px;">
                <tr>
                  <td style="background-color: #18181b; border-radius: 6px;">
                    <a href="${cancelHref}" style="display: inline-block; padding: 12px 24px; font-size: 16px; font-weight: 500; color: #ffffff; text-decoration: none;">
                      Cancel deletion
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 14px; line-height: 20px; color: #71717a;">
                If you didn't request this, email <a href="${cancelHref}" style="color: #71717a;">${recoveryEmail}</a> right away to keep your account.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #e4e4e7;">
              <p style="margin: 0 0 4px; font-size: 12px; color: #a1a1aa;">
                ${appName}
              </p>
              <p style="margin: 0; font-size: 12px; color: #a1a1aa;">
                ${LEGAL_ENTITY_NAME} · ${recoveryEmail}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim()

  const text = `
Account deletion scheduled

We received a request to delete your ${appName} account. Your account has been deactivated and you've been signed out on all devices.

Your account and all associated data are scheduled to be permanently deleted on ${formattedDate}, 30 days from now.

Changed your mind?
You can cancel the deletion and restore your account any time before that date by emailing ${recoveryEmail}. After ${formattedDate}, your data cannot be recovered.

If you didn't request this, email ${recoveryEmail} right away to keep your account.

---
${appName}
${LEGAL_ENTITY_NAME} · ${recoveryEmail}
`.trim()

  return { subject, html, text }
}
