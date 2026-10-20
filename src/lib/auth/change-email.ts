import 'server-only'
import { resend, isEmailConfigured, EMAIL_SENDERS, envSubject } from '@/lib/resend'
import { resolveEmailLocale } from '@/lib/emails/locale'
import { generateEmailChangedEmail } from '@/lib/emails/email-changed'
import { clearReminderConfirmation } from '@/lib/weekly-reminder'
import { CHANGE_EMAIL_REQUEST_TYPE } from '@/lib/email-verification'

/**
 * Account email change (HON-1137).
 *
 * `user.changeEmail` in `src/lib/auth.ts` keeps Better Auth's default: the
 * address changes only when the link sent to the new address is opened.
 * `/change-email` signs a token `{ email: old, updateTo: new, requestType }`
 * and sends it through `emailVerification.sendVerificationEmail`, and
 * `/verify-email` then sets the new address through `updateUserByEmail`,
 * which runs `databaseHooks.user.update`. Both steps read the token here.
 */

/** Better Auth's endpoint that opens the link and applies the change. */
const VERIFY_EMAIL_PATH = '/verify-email'

export interface ChangeEmailToken {
  /** The address before the change. */
  email: string
  /** The address the link confirms. */
  updateTo: string
}

/**
 * The change in a Better Auth email-verification token, or null when the token
 * is not a change-email token.
 *
 * It reads the payload without checking the signature, so call it only on a
 * token Better Auth has just signed (the send callback) or verified (the
 * update hook on `/verify-email`, which runs after `jwtVerify`).
 */
export function readChangeEmailToken(token: unknown): ChangeEmailToken | null {
  if (typeof token !== 'string') return null
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const data: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof data !== 'object' || data === null) return null
    const { email, updateTo, requestType } = data as Record<string, unknown>
    if (requestType !== CHANGE_EMAIL_REQUEST_TYPE) return null
    if (typeof email !== 'string' || typeof updateTo !== 'string') return null
    return { email, updateTo }
  } catch {
    return null
  }
}

/** The part of Better Auth's endpoint context the update hook reads. */
interface HookContext {
  path?: string
  query?: Record<string, unknown> | null
}

/**
 * `databaseHooks.user.update.after`. When the update is a confirmed email
 * change, forget the weekly-reminder confirmation (it proves the old address)
 * and tell the old address.
 *
 * The hook also runs for a name change and for a plain verification, so it
 * acts only on `/verify-email` with a change token whose new address is the
 * one now stored. It never throws: the change is already committed, and the
 * redirect back to `/account` must still happen.
 */
export async function afterAccountEmailChange(
  user: { id: string; email: string } | null | undefined,
  ctx: HookContext | null | undefined,
): Promise<void> {
  if (!user || ctx?.path !== VERIFY_EMAIL_PATH) return
  const change = readChangeEmailToken(ctx.query?.token)
  if (!change || change.updateTo.toLowerCase() !== user.email.toLowerCase()) return

  try {
    await clearReminderConfirmation(user.id)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to clear the reminder confirmation after an email change:', error)
  }

  await sendEmailChangedNotice({ userId: user.id, oldEmail: change.email, newEmail: user.email })
}

/** The notice to the old address. Logs and returns on any failure, like `sendResetPassword`. */
async function sendEmailChangedNotice({
  userId,
  oldEmail,
  newEmail,
}: {
  userId: string
  oldEmail: string
  newEmail: string
}): Promise<void> {
  if (!isEmailConfigured() || !resend) {
    // eslint-disable-next-line no-console
    console.warn('Email not configured. Email-changed notice not sent.')
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.log('Email-changed notice:', { to: oldEmail, newEmail })
    }
    return
  }

  try {
    const locale = await resolveEmailLocale(userId)
    const { subject, ...rest } = generateEmailChangedEmail({ newEmail, locale })
    await resend.emails.send({
      from: EMAIL_SENDERS.auth,
      to: oldEmail,
      subject: envSubject(subject),
      ...rest,
    })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to send the email-changed notice:', error)
  }
}
