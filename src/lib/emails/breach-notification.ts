import { serverEnv } from '@/lib/env'

/**
 * Data Breach Notification Email Template (GDPR Art. 34)
 *
 * Generates the email sent to affected users when a personal-data breach is
 * classified High severity and Art. 34 user notification is triggered.
 *
 * This template is filled in and sent by an operator via an ad-hoc script at
 * breach time — there is no automated send trigger. The operator supplies the
 * plain-language content; see `docs/RUNBOOKS/breach-notification.md`.
 *
 * Includes HTML with inline styles (email-safe) and a plain text fallback,
 * mirroring `reset-password.ts`.
 */

interface BreachNotificationEmailOptions {
  /** Plain-language summary of what happened. No jargon. */
  summary: string
  /** What data of theirs was exposed and what that means for them. */
  impact: string
  /** Concrete steps the user should take (change password, watch for phishing). */
  remediation: string
  /** Where the user can get help or read more (support page / status page URL). */
  supportUrl: string
}

interface EmailContent {
  subject: string
  html: string
  text: string
}

/**
 * Escapes HTML-significant characters so operator-typed free text (summary,
 * impact, remediation) and the support URL cannot break the email markup. A
 * stray `<`, `>`, `&`, or `"` in breach-time prose would otherwise corrupt the
 * rendered HTML. The plain-text branch needs no escaping.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Generates the affected-user breach notification email content.
 *
 * @param options - summary, impact, remediation, and a support URL
 * @returns Object with subject, html, and text content
 */
export function generateBreachNotificationEmail(
  options: BreachNotificationEmailOptions,
): EmailContent {
  const { summary, impact, remediation, supportUrl } = options
  const appName = serverEnv.NEXT_PUBLIC_APP_NAME

  const subject = `Important security notice about your ${appName} account`

  // Escape operator-typed fields for the HTML branch only; plain text is raw.
  const safeSummary = escapeHtml(summary)
  const safeImpact = escapeHtml(impact)
  const safeRemediation = escapeHtml(remediation)
  const safeSupportUrl = escapeHtml(supportUrl)

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
                Important security notice
              </h1>
              <p style="margin: 0 0 24px; font-size: 16px; line-height: 24px; color: #3f3f46;">
                ${safeSummary}
              </p>
              <h2 style="margin: 0 0 12px; font-size: 18px; font-weight: 600; color: #18181b;">
                What was affected
              </h2>
              <p style="margin: 0 0 24px; font-size: 16px; line-height: 24px; color: #3f3f46;">
                ${safeImpact}
              </p>
              <h2 style="margin: 0 0 12px; font-size: 18px; font-weight: 600; color: #18181b;">
                What you should do
              </h2>
              <p style="margin: 0 0 32px; font-size: 16px; line-height: 24px; color: #3f3f46;">
                ${safeRemediation}
              </p>
              <table role="presentation" style="margin: 0 0 32px;">
                <tr>
                  <td style="background-color: #18181b; border-radius: 6px;">
                    <a href="${safeSupportUrl}" style="display: inline-block; padding: 12px 24px; font-size: 16px; font-weight: 500; color: #ffffff; text-decoration: none;">
                      Get help
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 14px; line-height: 20px; color: #71717a;">
                We are sorry this happened. We take the security of your data seriously and have taken steps to address the issue. If you have any questions, reach us at the link above.
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
Important security notice about your ${appName} account

${summary}

What was affected
${impact}

What you should do
${remediation}

Get help: ${supportUrl}

We are sorry this happened. We take the security of your data seriously and have taken steps to address the issue. If you have any questions, reach us at the link above.

---
${appName}
`.trim()

  return { subject, html, text }
}
