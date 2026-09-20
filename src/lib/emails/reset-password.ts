import { serverEnv } from '@/lib/env'
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales'
import { emailTranslator } from './i18n'

/**
 * Password Reset Email Template
 *
 * Generates email content for password reset requests.
 * Includes HTML with inline styles (email-safe) and plain text fallback.
 *
 * Copy lives in `messages/{en,et}.json` under `emails.resetPassword`. The
 * locale is resolved at the call site (`resolveEmailLocale`), so this stays a
 * pure function — see `./i18n.ts` for why `getTranslations` is not used.
 */

interface ResetPasswordEmailOptions {
  resetUrl: string
  /** Recipient locale. Defaults to English for callers that cannot resolve one. */
  locale?: Locale
}

interface EmailContent {
  subject: string
  html: string
  text: string
}

/**
 * Generates password reset email content
 *
 * @param options - Email options containing the reset URL and recipient locale
 * @returns Object with subject, html, and text content
 */
export function generateResetPasswordEmail(options: ResetPasswordEmailOptions): EmailContent {
  const { resetUrl, locale = DEFAULT_LOCALE } = options
  const appName = serverEnv.NEXT_PUBLIC_APP_NAME
  const t = emailTranslator(locale, 'resetPassword')

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
              <p style="margin: 0 0 24px; font-size: 16px; line-height: 24px; color: #3f3f46;">
                ${t('intro', { appName })}
              </p>
              <p style="margin: 0 0 32px; font-size: 16px; line-height: 24px; color: #3f3f46;">
                ${t('instructionHtml')}
              </p>
              <table role="presentation" style="margin: 0 0 32px;">
                <tr>
                  <td style="background-color: #18181b; border-radius: 6px;">
                    <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; font-size: 16px; font-weight: 500; color: #ffffff; text-decoration: none;">
                      ${t('cta')}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 16px; font-size: 14px; line-height: 20px; color: #71717a;">
                ${t('expiry')}
              </p>
              <p style="margin: 0; font-size: 14px; line-height: 20px; color: #71717a;">
                ${t('ignore')}
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

${t('intro', { appName })}

${t('instructionText')}
${resetUrl}

${t('expiry')}

${t('ignore')}

---
${appName}
`.trim()

  return { subject, html, text }
}
