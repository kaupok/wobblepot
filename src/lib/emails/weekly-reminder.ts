import { serverEnv } from '@/lib/env'
import type { Locale } from '@/lib/i18n/locales'
import { emailTranslator } from './i18n'

/**
 * Weekly planning reminder (HON-1084): sent by `/api/cron/weekly-reminders`
 * on the member's chosen weekday, only when next week has no meals planned.
 * The member switched it on, and the footer link stops it without a sign-in.
 *
 * Copy lives in `messages/{en,et}.json` under `emails.weeklyReminder`. The
 * locale is the household's (`resolveEmailLocale`).
 */

interface WeeklyReminderEmailOptions {
  /** The app root, where next week is planned. */
  appUrl: string
  /** The public stop page, `/reminders/stop?token=…`. */
  stopUrl: string
  locale: Locale
}

interface EmailContent {
  subject: string
  html: string
  text: string
}

export function generateWeeklyReminderEmail(options: WeeklyReminderEmailOptions): EmailContent {
  const { appUrl, stopUrl, locale } = options
  const appName = serverEnv.NEXT_PUBLIC_APP_NAME
  const t = emailTranslator(locale, 'weeklyReminder')

  const subject = t('subject')

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
                ${t('body')}
              </p>
              <table role="presentation" style="margin: 0;">
                <tr>
                  <td style="background-color: #18181b; border-radius: 6px;">
                    <a href="${appUrl}" style="display: inline-block; padding: 12px 24px; font-size: 16px; font-weight: 500; color: #ffffff; text-decoration: none;">
                      ${t('cta')}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #e4e4e7;">
              <p style="margin: 0 0 8px; font-size: 12px; line-height: 18px; color: #71717a;">
                ${t('footer', { appName })}
              </p>
              <p style="margin: 0; font-size: 12px; line-height: 18px;">
                <a href="${stopUrl}" style="color: #71717a; text-decoration: underline;">${t('stop')}</a>
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

${t('body')}

${t('cta')}:
${appUrl}

---
${t('footer', { appName })}
${t('stop')}: ${stopUrl}
`.trim()

  return { subject, html, text }
}
