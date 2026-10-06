import { serverEnv } from '@/lib/env'
import type { Locale } from '@/lib/i18n/locales'
import { emailTranslator } from './i18n'

/**
 * Waitlist confirmation email (HON-846): the double opt-in step. A request on
 * `/request-invite` counts only once its recipient opens this link.
 *
 * Copy lives in `messages/{en,et}.json` under `emails.waitlistConfirm`. The
 * locale is the page locale sent with the request, not `resolveEmailLocale`:
 * the recipient has no account, so there is no household to read it from.
 */

interface WaitlistConfirmEmailOptions {
  confirmUrl: string
  locale: Locale
}

interface EmailContent {
  subject: string
  html: string
  text: string
}

export function generateWaitlistConfirmEmail(options: WaitlistConfirmEmailOptions): EmailContent {
  const { confirmUrl, locale } = options
  const appName = serverEnv.NEXT_PUBLIC_APP_NAME
  const t = emailTranslator(locale, 'waitlistConfirm')

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
                    <a href="${confirmUrl}" style="display: inline-block; padding: 12px 24px; font-size: 16px; font-weight: 500; color: #ffffff; text-decoration: none;">
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
${confirmUrl}

${t('expiry')}

${t('ignore')}

---
${appName}
`.trim()

  return { subject, html, text }
}
