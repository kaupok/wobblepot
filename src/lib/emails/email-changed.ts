import { serverEnv } from '@/lib/env'
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales'
import { SUPPORT_EMAIL, SUPPORT_EMAIL_HREF } from '@/lib/support'

import { escapeHtml } from './escape-html'
import { emailTranslator } from './i18n'

/**
 * Account email change, the notice to the old address (HON-1137).
 *
 * Sent after the link to the new address was opened. A person with a
 * signed-in session can move the account to their own address, and the owner
 * then can no longer reset the password through the old one, so this mail
 * tells the owner and names support. Copy lives under `emails.emailChanged`.
 */

interface EmailChangedEmailOptions {
  /** The address the account uses now. The user typed it, so the HTML escapes it. */
  newEmail: string
  /** Recipient locale. Defaults to English for callers that cannot resolve one. */
  locale?: Locale
}

interface EmailContent {
  subject: string
  html: string
  text: string
}

export function generateEmailChangedEmail(options: EmailChangedEmailOptions): EmailContent {
  const { newEmail, locale = DEFAULT_LOCALE } = options
  const appName = serverEnv.NEXT_PUBLIC_APP_NAME
  const t = emailTranslator(locale, 'emailChanged')

  const subject = t('subject', { appName })

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
              <p style="margin: 0 0 16px; font-size: 16px; line-height: 24px; color: #3f3f46;">
                ${t('intro', { appName, newEmail: `<strong>${escapeHtml(newEmail)}</strong>` })}
              </p>
              <p style="margin: 0; font-size: 16px; line-height: 24px; color: #3f3f46;">
                ${t.markup('notYou', {
                  email: SUPPORT_EMAIL,
                  link: (chunks) =>
                    `<a href="${SUPPORT_EMAIL_HREF}" style="color: #18181b;">${chunks}</a>`,
                })}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #e4e4e7;">
              <p style="margin: 0; font-size: 12px; color: #a1a1aa;">
                ${appName}
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
${subject}

${t('intro', { appName, newEmail })}

${t.markup('notYou', { email: SUPPORT_EMAIL, link: (chunks) => chunks })}

---
${appName}
`.trim()

  return { subject, html, text }
}
