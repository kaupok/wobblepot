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
 * single-use code, links it to the request, emails it in the request's
 * locale, and only then expires the code sent before (if it is still unused)
 * and sets `invitedAt`.
 *
 * A failed send is undone: the new code is expired and the request points at
 * its previous code again, so the recipient keeps the code they already have
 * and `invitedAt` still means "an invite went out".
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
    const previousCodeId = request.signupCodeId
    await prisma.$transaction(async (tx) => {
      const created = await tx.signupCode.create({
        data: {
          code,
          expiresAt: new Date(now.getTime() + WAITLIST_INVITE_TTL_DAYS * DAY_MS),
          note: 'waitlist',
          createdById: session.user.id,
        },
        select: { id: true },
      })
      await tx.waitlistRequest.update({ where: { id }, data: { signupCodeId: created.id } })
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
        await prisma.$transaction(async (tx) => {
          await tx.signupCode.updateMany({ where: { code }, data: { expiresAt: now } })
          await tx.waitlistRequest.update({ where: { id }, data: { signupCodeId: previousCodeId } })
        })
      } catch (error) {
        captureApiError(error, { route: ROUTE, userId: session.user.id })
      }
      return NextResponse.json({ error: 'Failed to send the invite email' }, { status: 502 })
    }

    const invitedAt = await prisma.$transaction(async (tx) => {
      if (previousCodeId) {
        await tx.signupCode.updateMany({
          where: { id: previousCodeId, usedAt: null },
          data: { expiresAt: now },
        })
      }
      const updated = await tx.waitlistRequest.update({
        where: { id },
        data: { invitedAt: now },
        select: { invitedAt: true },
      })
      return updated.invitedAt
    })
    return NextResponse.json({ invitedAt: invitedAt?.toISOString() ?? null })
  } catch (error) {
    captureApiError(error, { route: ROUTE, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to send the invite' }, { status: 500 })
  }
}
