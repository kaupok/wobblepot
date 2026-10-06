import { NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { requireAdmin } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { captureApiError } from '@/lib/errors'
import { getServerBaseURL } from '@/lib/env'
import { resend, isEmailConfigured, EMAIL_SENDERS, envSubject } from '@/lib/resend'
import { generateWaitlistInviteEmail } from '@/lib/emails/waitlist-invite'
import { DEFAULT_LOCALE, isKnownLocale } from '@/lib/i18n/locales'
import { WAITLIST_INVITE_TTL_DAYS } from '@/lib/waitlist'

const ROUTE = '/api/admin/waitlist/[id]/invite'
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Send invite / Send again on `/admin/waitlist` (HON-970). Mints a fresh
 * single-use code and emails it in the request's locale. Only once the email
 * is accepted does it link the new code to the request, expire the code sent
 * before (if it is still unused) and set `invitedAt`.
 *
 * Linking last keeps the previous code's link intact while the email is in
 * flight, so a sign-up with that code meanwhile still deletes the request
 * (`linkUsedBy`). A failed send deletes the unsent code and changes nothing
 * else, so `invitedAt` always means "an invite went out".
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin()
  if (guard.error) return guard.error
  const { session } = guard

  // Checked before any write: minting a code nobody receives would read as sent.
  if (!isEmailConfigured() || !resend) {
    return NextResponse.json({ error: 'Email is not configured' }, { status: 503 })
  }

  try {
    const { id } = await ctx.params
    const request = await prisma.waitlistRequest.findFirst({
      where: { id, confirmedAt: { not: null } },
      select: { email: true, locale: true, signupCodeId: true },
    })
    if (!request) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    const now = new Date()
    const code = nanoid(12)
    const created = await prisma.signupCode.create({
      data: {
        code,
        expiresAt: new Date(now.getTime() + WAITLIST_INVITE_TTL_DAYS * DAY_MS),
        note: 'waitlist',
        createdById: session.user.id,
      },
      select: { id: true },
    })

    const locale = isKnownLocale(request.locale) ? request.locale : DEFAULT_LOCALE
    const { subject, ...rest } = generateWaitlistInviteEmail({
      code,
      signUpUrl: `${getServerBaseURL()}/sign-up`,
      validDays: WAITLIST_INVITE_TTL_DAYS,
      locale,
    })

    // Resend reports API errors in `error` rather than throwing.
    let sendError: unknown = null
    try {
      const result = await resend.emails.send({
        from: EMAIL_SENDERS.auth,
        to: request.email,
        subject: envSubject(subject),
        ...rest,
      })
      sendError = result.error
    } catch (error) {
      sendError = error
    }
    if (sendError) {
      captureApiError(sendError, { route: ROUTE, userId: session.user.id })
      try {
        await prisma.signupCode.delete({ where: { id: created.id } })
      } catch (error) {
        captureApiError(error, { route: ROUTE, userId: session.user.id })
      }
      return NextResponse.json({ error: 'Failed to send the invite email' }, { status: 502 })
    }

    const invitedAt = await prisma.$transaction(async (tx) => {
      // `updateMany` so a request deleted during the send (Remove, or a
      // sign-up with the previous code) reads as a count of 0, not a throw.
      const { count } = await tx.waitlistRequest.updateMany({
        where: { id },
        data: { invitedAt: now, signupCodeId: created.id },
      })
      if (count === 0) return null
      if (request.signupCodeId) {
        await tx.signupCode.updateMany({
          where: { id: request.signupCodeId, usedAt: null },
          data: { expiresAt: now },
        })
      }
      return now
    })
    if (!invitedAt) {
      // The email went out, but the request is gone; nothing is left to record.
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }
    return NextResponse.json({ invitedAt: invitedAt.toISOString() })
  } catch (error) {
    captureApiError(error, { route: ROUTE, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to send the invite' }, { status: 500 })
  }
}
