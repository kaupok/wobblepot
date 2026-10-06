import 'server-only'
import { nanoid } from 'nanoid'
import { prisma } from '@/lib/prisma'
import { getServerBaseURL } from '@/lib/env'
import { captureApiError } from '@/lib/errors'
import { resend, isEmailConfigured, EMAIL_SENDERS, envSubject } from '@/lib/resend'
import { generateWaitlistConfirmEmail } from '@/lib/emails/waitlist-confirm'
import type { Locale } from '@/lib/i18n/locales'

/**
 * The invite waitlist (HON-846): a visitor without an invite code leaves an
 * email on `/request-invite` and confirms it from the emailed link (double
 * opt-in, GDPR Art. 6(1)(a)). The admin half — the list, the invite email,
 * Remove — is HON-970.
 *
 * The windows below are published in the privacy policy and the confirmation
 * email. The route, the confirm page and the purge cron all read them from
 * here, so they cannot drift apart.
 */

/** Days a confirmation link works, and days an unconfirmed request is kept. */
export const WAITLIST_TOKEN_TTL_DAYS = 7

/** Months a confirmed request is kept after confirmation. */
export const WAITLIST_CONFIRMED_RETENTION_MONTHS = 6

/**
 * Minimum gap between two confirmation emails to one address. The route's
 * limit is per IP, so without this a caller with many IPs could mail one
 * inbox without bound from the sender that password resets also use.
 */
export const WAITLIST_RESEND_COOLDOWN_MS = 10 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

/** Requests made (or reissued) before this instant are expired. */
export function unconfirmedCutoff(now: Date): Date {
  return new Date(now.getTime() - WAITLIST_TOKEN_TTL_DAYS * DAY_MS)
}

/** Requests confirmed before this instant are past retention. */
export function confirmedCutoff(now: Date): Date {
  const cutoff = new Date(now)
  cutoff.setUTCMonth(cutoff.getUTCMonth() - WAITLIST_CONFIRMED_RETENTION_MONTHS)
  return cutoff
}

/** The stored form of an address: trimmed and lowercased, as Better Auth stores `user.email`. */
export function normalizeWaitlistEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Confirms the request that owns `token`, if the token exists and is within
 * {@link WAITLIST_TOKEN_TTL_DAYS} of being issued.
 *
 * The token is not cleared on confirmation. Mail security gateways (Safe
 * Links and the like) open every link in an email before the person does, so
 * a single-use token would show the person "expired" for a request that just
 * succeeded. A second open of the same link is therefore a no-op that still
 * reads as confirmed. The token stops working when a resubmit replaces it or
 * when it is 7 days old.
 *
 * A click on a reissued token (a confirmed person asked again) is new
 * consent, so it moves `confirmedAt` to now and restarts the 6-month
 * retention.
 *
 * @returns true when the request is confirmed, false for a missing, unknown,
 * expired or replaced token.
 */
export async function confirmWaitlistToken(
  token: string | undefined,
  now: Date = new Date(),
): Promise<boolean> {
  if (!token) return false

  const request = await prisma.waitlistRequest.findUnique({
    where: { confirmToken: token },
    select: { id: true, createdAt: true, confirmedAt: true },
  })
  if (!request || request.createdAt < unconfirmedCutoff(now)) return false

  // Confirmed after this token was issued: this link already did its work.
  if (request.confirmedAt && request.confirmedAt >= request.createdAt) return true

  // Keyed on the token as well as the id, so a resubmit that replaced the
  // token since the read above is not confirmed by the old link.
  const { count } = await prisma.waitlistRequest.updateMany({
    where: { id: request.id, confirmToken: token },
    data: { confirmedAt: now },
  })
  return count > 0
}

/**
 * Handles a valid request from `POST /api/waitlist`. The route runs this in
 * `after()`, once the response is sent, so the response takes the same time
 * whichever case runs here and reveals nothing about the address.
 *
 * - An address with an account: nothing. The sign-in page is its answer.
 * - An address emailed less than {@link WAITLIST_RESEND_COOLDOWN_MS} ago:
 *   nothing. Its last link still works.
 * - Any other address (new, unconfirmed or confirmed): a new token,
 *   `createdAt` reset to now, and the confirmation email. A confirmed row
 *   keeps its `confirmedAt` until the new link is clicked; see
 *   {@link confirmWaitlistToken}.
 *
 * Never throws: every failure is logged, because nobody is left to answer.
 */
export async function processWaitlistRequest({
  email,
  locale,
}: {
  email: string
  locale: Locale
}): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (user) return

    const now = new Date()
    const existing = await prisma.waitlistRequest.findUnique({
      where: { email },
      select: { createdAt: true },
    })
    if (existing && now.getTime() - existing.createdAt.getTime() < WAITLIST_RESEND_COOLDOWN_MS) {
      return
    }

    const confirmToken = nanoid(32)
    await prisma.waitlistRequest.upsert({
      where: { email },
      create: { email, locale, confirmToken, createdAt: now },
      update: { locale, confirmToken, createdAt: now },
    })

    await sendConfirmationEmail(email, confirmToken, locale)
  } catch (error) {
    captureApiError(error, { route: '/api/waitlist' })
  }
}

async function sendConfirmationEmail(to: string, token: string, locale: Locale): Promise<void> {
  const confirmUrl = `${getServerBaseURL()}/request-invite/confirm?token=${encodeURIComponent(token)}`

  if (!isEmailConfigured() || !resend) {
    // eslint-disable-next-line no-console
    console.warn('Email not configured. Waitlist confirmation email not sent.')
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.log('Waitlist confirm URL:', confirmUrl)
    }
    return
  }

  const { subject, ...rest } = generateWaitlistConfirmEmail({ confirmUrl, locale })

  try {
    await resend.emails.send({
      from: EMAIL_SENDERS.auth,
      to,
      subject: envSubject(subject),
      ...rest,
    })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to send waitlist confirmation email:', error)
  }
}

/**
 * Deletes the requests past retention: unconfirmed ones made more than
 * {@link WAITLIST_TOKEN_TTL_DAYS} ago, and confirmed ones confirmed more than
 * {@link WAITLIST_CONFIRMED_RETENTION_MONTHS} ago and whose latest link has
 * also expired. Run daily by `/api/cron/purge-deleted-users`.
 */
export async function purgeExpiredWaitlistRequests(
  now: Date = new Date(),
): Promise<{ unconfirmed: number; confirmed: number }> {
  const unconfirmed = await prisma.waitlistRequest.deleteMany({
    where: { confirmedAt: null, createdAt: { lt: unconfirmedCutoff(now) } },
  })
  // A confirmed row whose person asked again in the last 7 days has a live
  // link that would restart its retention; let that link expire first.
  const confirmed = await prisma.waitlistRequest.deleteMany({
    where: {
      confirmedAt: { lt: confirmedCutoff(now) },
      createdAt: { lt: unconfirmedCutoff(now) },
    },
  })
  return { unconfirmed: unconfirmed.count, confirmed: confirmed.count }
}
