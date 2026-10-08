import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { captureApiError } from '@/lib/errors'
import { checkRateLimit } from '@/lib/rate-limit'
import { reminderUpdate, sendReminderConfirmEmail } from '@/lib/weekly-reminder'
import { REMINDER_WEEKDAYS, type ReminderWeekday } from '@/lib/weekly-reminder-schedule'

const bodySchema = z.object({
  weekday: z
    .number()
    .int()
    .refine((value): value is ReminderWeekday =>
      (REMINDER_WEEKDAYS as readonly number[]).includes(value),
    )
    .nullable(),
})

/**
 * PATCH /api/households/me/members/me/reminder
 *
 * The caller's own weekly planning reminder (HON-1084). Body
 * `{ weekday: 1..7 | null }`: a weekday switches it on for that ISO weekday,
 * `null` switches it off. Any member with an account may call it, owner or
 * not, because the consent is theirs (`reminderUpdate` says what is written).
 *
 * Switching it on while the address is not confirmed emails a confirm link
 * (HON-1113); the cron sends nothing until it is opened. Changing the day
 * sends nothing, and switching off and on again is the resend path, bounded
 * by the `reminder-confirm` rate limit. The email goes out after the save,
 * and a failure to send it never fails the save.
 */
export async function PATCH(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
  }

  try {
    const member = await prisma.householdMember.findUnique({
      where: { userId: session.user.id },
      select: {
        id: true,
        reminderWeekday: true,
        reminderConsentAt: true,
        reminderToken: true,
        reminderConfirmToken: true,
        reminderConfirmedAt: true,
      },
    })
    if (!member) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    const data = reminderUpdate(member, parsed.data.weekday)
    await prisma.householdMember.update({ where: { id: member.id }, data })

    const switchedOn = member.reminderWeekday === null && data.reminderWeekday !== null
    if (switchedOn && !member.reminderConfirmedAt && data.reminderConfirmToken) {
      await sendConfirmEmail(session.user, data.reminderConfirmToken)
    }

    return NextResponse.json({ weekday: parsed.data.weekday })
  } catch (error) {
    captureApiError(error, {
      route: '/api/households/me/members/me/reminder',
      userId: session.user.id,
    })
    return NextResponse.json({ error: 'Failed to save the reminder' }, { status: 500 })
  }
}

/** Sends the confirm email, or logs why it did not. Never throws. */
async function sendConfirmEmail(user: { id: string; email: string }, token: string) {
  try {
    const limit = await checkRateLimit(user.id, 'reminder-confirm')
    if (!limit.allowed) {
      // eslint-disable-next-line no-console
      console.warn('Weekly reminder confirm email rate limited; not sent.')
      return
    }
    await sendReminderConfirmEmail({ to: user.email, userId: user.id, token })
  } catch (error) {
    captureApiError(error, {
      route: '/api/households/me/members/me/reminder',
      userId: user.id,
      step: 'confirm-email',
    })
  }
}
