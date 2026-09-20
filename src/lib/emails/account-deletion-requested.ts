import { serverEnv } from '@/lib/env'
import { LEGAL_ENTITY_NAME } from '@/lib/support'
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales'
import { formatLongDate } from '@/lib/i18n/format-dates'
import { emailTranslator } from './i18n'

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
 * Copy lives in `messages/{en,et}.json` under `emails.accountDeletionRequested`.
 * The locale is resolved at the call site (`resolveEmailLocale`), so this stays
 * a pure function — see `./i18n.ts` for why `getTranslations` is not used.
 *
 * Inline HTML with email-safe styles + a plain-text fallback, mirroring
 * `reset-password.ts`.
 */

interface AccountDeletionRequestedEmailOptions {
  /** When the account is hard-deleted — the cron-aligned purge instant. */
  purgeDate: Date
  /** Address the user emails to cancel deletion within the grace window. */
  recoveryEmail: string
  /** Recipient locale. Defaults to English for callers that cannot resolve one. */
  locale?: Locale
}

interface EmailContent {
  subject: string
  html: string
  text: string
}

/**
 * Generates account-deletion-requested email content.
 *
 * @param options - the purge date, the recovery (cancellation) email, and the
 *   recipient locale
 * @returns Object with subject, html, and text content
 */
export function generateAccountDeletionRequestedEmail(
  options: AccountDeletionRequestedEmailOptions,
): EmailContent {
  const { purgeDate, recoveryEmail, locale = DEFAULT_LOCALE } = options
  const appName = serverEnv.NEXT_PUBLIC_APP_NAME
  const t = emailTranslator(locale, 'accountDeletionRequested')
  // Pinned to UTC: `purgeScheduledFor` is a UTC timestamp and the purge cron
  // runs at 03:00 UTC, so a server in a positive-offset zone must not quote the
  // following calendar day. `DeleteAccountDialog` pins it the same way, so the
  // dialog and this email always name the same date (HON-705).
  const formattedDate = formatLongDate(purgeDate, locale, { timeZone: 'UTC' })
  const cancelHref = `mailto:${recoveryEmail}?subject=${encodeURIComponent(t('cancelMailtoSubject'))}`

  const subject = t('subject', { appName, date: formattedDate })

  const html = `
<!DOCTYPE html>
<html lang="${locale}">
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
                ${t('heading')}
              </h1>
              <p style="margin: 0 0 24px; font-size: 16px; line-height: 24px; color: #3f3f46;">
                ${t('intro', { appName })}
              </p>
              <p style="margin: 0 0 32px; font-size: 16px; line-height: 24px; color: #3f3f46;">
                ${t.markup('scheduledFor', {
                  date: formattedDate,
                  strong: (chunks) => `<strong>${chunks}</strong>`,
                })}
              </p>
              <h2 style="margin: 0 0 12px; font-size: 18px; font-weight: 600; color: #18181b;">
                ${t('changedMindHeading')}
              </h2>
              <p style="margin: 0 0 32px; font-size: 16px; line-height: 24px; color: #3f3f46;">
                ${t('changedMindHtml', { date: formattedDate })}
              </p>
              <table role="presentation" style="margin: 0 0 32px;">
                <tr>
                  <td style="background-color: #18181b; border-radius: 6px;">
                    <a href="${cancelHref}" style="display: inline-block; padding: 12px 24px; font-size: 16px; font-weight: 500; color: #ffffff; text-decoration: none;">
                      ${t('cta')}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 14px; line-height: 20px; color: #71717a;">
                ${t.markup('lastWarning', {
                  email: recoveryEmail,
                  link: (chunks) => `<a href="${cancelHref}" style="color: #71717a;">${chunks}</a>`,
                })}
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
${t('heading')}

${t('intro', { appName })}

${t.markup('scheduledFor', { date: formattedDate, strong: (chunks) => chunks })}

${t('changedMindHeading')}
${t('changedMindText', { date: formattedDate, email: recoveryEmail })}

${t.markup('lastWarning', { email: recoveryEmail, link: (chunks) => chunks })}

---
${appName}
${LEGAL_ENTITY_NAME} · ${recoveryEmail}
`.trim()

  return { subject, html, text }
}
