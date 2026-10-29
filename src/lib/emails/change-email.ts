import type { Locale } from '@/lib/i18n/locales'

import { generateConfirmLinkEmail } from './verify-email'

/**
 * Account email change, the mail to the new address (HON-1137).
 *
 * Better Auth sends the change token through the same `sendVerificationEmail`
 * as sign-up, so `src/lib/auth/change-email.ts` picks this template when the
 * token is a change. Copy lives under `emails.changeEmail`. The address changes
 * only when the link is opened, so the `ignore` line tells a reader who did
 * not ask for it that nothing happens if they do nothing.
 */
export function generateChangeEmailEmail(options: { verifyUrl: string; locale?: Locale }) {
  return generateConfirmLinkEmail('changeEmail', options)
}
