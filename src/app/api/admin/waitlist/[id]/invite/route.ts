import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/auth-helpers'
import { generateWaitlistInviteEmail } from '@/lib/emails/waitlist-invite'
import { getServerBaseURL } from '@/lib/env'
import { captureApiError } from '@/lib/errors'
import { DEFAULT_LOCALE, isKnownLocale } from '@/lib/i18n/locales'
import { EMAIL_SENDERS, envSubject, isEmailConfigured, resend } from '@/lib/resend'
import {
  discardWaitlistInviteCode,
  markWaitlistInvited,
  prepareWaitlistInvite,
  WAITLIST_INVITE_TTL_DAYS,
  WaitlistError,
} from '@/lib/waitlist'

const ROUTE = '/api/admin/waitlist/[id]/invite'

/**
 * Send invite / Send again on `/admin/waitlist` (HON-970). Mints a fresh
 * single-use code (`prepareWaitlistInvite`) and emails it in the request's
 * locale. Only once the email is accepted does it link the new code to the
 * request (`markWaitlistInvited`). A failed send deletes the unsent code and
 * changes nothing else, so `invitedAt` always means "an invite went out".
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
    const now = new Date()
    const invite = await prepareWaitlistInvite({
      requestId: id,
      createdById: session.user.id,
      now,
    })

    const locale = isKnownLocale(invite.locale) ? invite.locale : DEFAULT_LOCALE
    const { subject, ...rest } = generateWaitlistInviteEmail({
      code: invite.code,
      signUpUrl: `${getServerBaseURL()}/sign-up`,
      validDays: WAITLIST_INVITE_TTL_DAYS,
      locale,
    })

    // Resend reports API errors in `error` rather than throwing.
    let sendError: unknown = null
    try {
      const result = await resend.emails.send({
        from: EMAIL_SENDERS.auth,
        to: invite.email,
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
        await discardWaitlistInviteCode(invite.codeId)
      } catch (error) {
        captureApiError(error, { route: ROUTE, userId: session.user.id })
      }
      return NextResponse.json({ error: 'Failed to send the invite email' }, { status: 502 })
    }

    await markWaitlistInvited({
      requestId: id,
      previousCodeId: invite.previousCodeId,
      codeId: invite.codeId,
      now,
    })
    return NextResponse.json({ invitedAt: now.toISOString() })
  } catch (error) {
    if (error instanceof WaitlistError) {
      switch (error.reason) {
        case 'notFound':
          return NextResponse.json({ error: 'Request not found' }, { status: 404 })
        case 'accountExists':
          return NextResponse.json(
            { error: 'This address already has an account', code: 'ACCOUNT_EXISTS' },
            { status: 409 },
          )
        case 'inviteConflict':
          return NextResponse.json(
            { error: 'Another invite was sent at the same time', code: 'INVITE_CONFLICT' },
            { status: 409 },
          )
      }
    }
    captureApiError(error, { route: ROUTE, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to send the invite' }, { status: 500 })
  }
}
