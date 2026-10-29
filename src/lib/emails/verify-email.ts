import { serverEnv } from '@/lib/env'
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales'

import { type EmailNamespace, emailTranslator } from './i18n'

/**
 * Account email verification (HON-1155).
 *
 * Sent on sign-up and on Resend from `/account`. Copy lives in
 * `messages/{en,et}.json` under `emails.verifyEmail`. The `ignore` line is a
 * security control: a stranger who signs up with someone else's address must
 * not get it verified by the owner, so the mail tells the owner not to click.
 */

interface VerifyEmailEmailOptions {
  verifyUrl: string
  /** Recipient locale. Defaults to English for callers that cannot resolve one. */
  locale?: Locale
}

interface EmailContent {
  subject: string
  html: string
  text: string
}

export function generateVerifyEmailEmail(options: VerifyEmailEmailOptions): EmailContent {
  return generateConfirmLinkEmail('verifyEmail', options)
}

/**
 * The confirm-this-address layout, shared with the change-email mail
 * (HON-1137). `namespace` names the copy under `emails`; it must hold
 * `subject`, `heading`, `instructionHtml`, `instructionText`, `cta`, `expiry`
 * and `ignore`.
 */
export function generateConfirmLinkEmail(
  namespace: Extract<EmailNamespace, 'verifyEmail' | 'changeEmail'>,
  options: VerifyEmailEmailOptions,
): EmailContent {
  const { verifyUrl, locale = DEFAULT_LOCALE } = options
  const appName = serverEnv.NEXT_PUBLIC_APP_NAME
  const t = emailTranslator(locale, namespace)

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
              <p style="margin: 0 0 32px; font-size: 16px; line-height: 24px; color: #3f3f46;">
                ${t('instructionHtml', { appName })}
              </p>
              <table role="presentation" style="margin: 0 0 32px;">
                <tr>
                  <td style="background-color: #18181b; border-radius: 6px;">
                    <a href="${verifyUrl}" style="display: inline-block; padding: 12px 24px; font-size: 16px; font-weight: 500; color: #ffffff; text-decoration: none;">
                      ${t('cta')}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 16px; font-size: 14px; line-height: 20px; color: #71717a;">
                ${t('expiry')}
              </p>
              <p style="margin: 0; font-size: 14px; line-height: 20px; color: #71717a;">
                ${t('ignore', { appName })}
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

${t('instructionText', { appName })}
${verifyUrl}

${t('expiry')}

${t('ignore', { appName })}

---
${appName}
`.trim()

  return { subject, html, text }
}
