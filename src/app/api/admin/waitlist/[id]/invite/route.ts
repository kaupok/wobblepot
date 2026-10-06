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
 *
 * Error `code`s the client branches on: `ACCOUNT_EXISTS` (409, the address
 * already signed up) and `INVITE_CONFLICT` (409, another send linked its
 * code during this one's send).
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

    // Like `processWaitlistRequest`: an address with an account needs no code,
    // and one sent anyway could only be passed on to someone else.
    const user = await prisma.user.findUnique({
      where: { email: request.email },
      select: { id: true },
    })
    if (user) {
      return NextResponse.json(
        { error: 'This address already has an account', code: 'ACCOUNT_EXISTS' },
        { status: 409 },
      )
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

    const linked = await prisma.$transaction(async (tx) => {
      // Keyed on the code read before the send as well as the id: if another
      // send linked its code meanwhile, or the request was deleted, this
      // matches nothing. Postgres re-checks the predicate after waiting on a
      // concurrent update of the row, so two overlapping sends cannot both
      // win and leave one code valid but linked to nothing.
      const { count } = await tx.waitlistRequest.updateMany({
        where: { id, signupCodeId: request.signupCodeId },
        data: { invitedAt: now, signupCodeId: created.id },
      })
      if (count === 0) return false
      if (request.signupCodeId) {
        await tx.signupCode.updateMany({
          where: { id: request.signupCodeId, usedAt: null },
          data: { expiresAt: now },
        })
      }
      return true
    })

    if (!linked) {
      // This code went out but is linked to nothing, so a sign-up with it
      // would not delete the request. Expire it.
      await prisma.signupCode.updateMany({
        where: { id: created.id, usedAt: null },
        data: { expiresAt: now },
      })
      const stillThere = await prisma.waitlistRequest.findUnique({
        where: { id },
        select: { id: true },
      })
      return stillThere
        ? NextResponse.json(
            { error: 'Another invite was sent at the same time', code: 'INVITE_CONFLICT' },
            { status: 409 },
          )
        : NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }
    return NextResponse.json({ invitedAt: now.toISOString() })
  } catch (error) {
    captureApiError(error, { route: ROUTE, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to send the invite' }, { status: 500 })
  }
}
