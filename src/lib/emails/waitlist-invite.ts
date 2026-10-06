import { serverEnv } from '@/lib/env'
import type { Locale } from '@/lib/i18n/locales'
import { emailTranslator } from './i18n'

/**
 * Waitlist invite email (HON-970): the admin sends a confirmed waitlist
 * request a single-use signup code from `/admin/waitlist`.
 *
 * Copy lives in `messages/{en,et}.json` under `emails.waitlistInvite`. The
 * locale is the one stored on the request, because the recipient has no
 * account yet and so no household to read it from.
 */

interface WaitlistInviteEmailOptions {
  code: string
  signUpUrl: string
  /** Days the code works; the email states it. */
  validDays: number
  locale: Locale
}

interface EmailContent {
  subject: string
  html: string
  text: string
}

export function generateWaitlistInviteEmail(options: WaitlistInviteEmailOptions): EmailContent {
  const { code, signUpUrl, validDays, locale } = options
  const appName = serverEnv.NEXT_PUBLIC_APP_NAME
  const t = emailTranslator(locale, 'waitlistInvite')

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
                ${t('intro', { appName })}
              </p>
              <p style="margin: 0 0 24px; padding: 16px; font-family: 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace; font-size: 20px; letter-spacing: 1px; color: #18181b; background-color: #f4f4f5; border-radius: 6px; text-align: center;">
                ${code}
              </p>
              <p style="margin: 0 0 32px; font-size: 16px; line-height: 24px; color: #3f3f46;">
                ${t('instructionHtml')}
              </p>
              <table role="presentation" style="margin: 0 0 32px;">
                <tr>
                  <td style="background-color: #18181b; border-radius: 6px;">
                    <a href="${signUpUrl}" style="display: inline-block; padding: 12px 24px; font-size: 16px; font-weight: 500; color: #ffffff; text-decoration: none;">
                      ${t('cta')}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 16px; font-size: 14px; line-height: 20px; color: #71717a;">
                ${t('expiry', { days: validDays })}
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

${code}

${t('instructionText')}
${signUpUrl}

${t('expiry', { days: validDays })}

${t('ignore')}

---
${appName}
`.trim()

  return { subject, html, text }
}
