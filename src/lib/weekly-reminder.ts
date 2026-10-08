import 'server-only'
import { nanoid } from 'nanoid'
import { prisma } from '@/lib/prisma'
import { getServerBaseURL } from '@/lib/env'
import { captureApiError } from '@/lib/errors'
import { resend, isEmailConfigured, EMAIL_SENDERS, envSubject } from '@/lib/resend'
import { resolveEmailLocale } from '@/lib/emails/locale'
import { generateWeeklyReminderEmail } from '@/lib/emails/weekly-reminder'
import { generateReminderConfirmEmail } from '@/lib/emails/reminder-confirm'
import { getTodayInTimezone } from '@/lib/meal-planning/dates'
import { isoWeekday, nextWeekRange, type ReminderWeekday } from '@/lib/weekly-reminder-schedule'

/**
 * The opt-in weekly planning reminder email (HON-1084). A member switches it
 * on for themself on `/household` or at the first plan. The daily cron
 * (`/api/cron/weekly-reminders`) sends one email on their weekday when next
 * week has no meals planned, and the stop link ends it without a sign-in.
 *
 * Consent is the legal basis (the policy names it under Consent), so nothing
 * here switches a reminder on for anyone but the caller.
 *
 * Sign-up does not verify the address, so the consent has to come from the
 * inbox owner (HON-1113): the first switch-on emails a confirm link, and the
 * cron sends only once `reminderConfirmedAt` is set.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Days the confirm link works, counted from the switch-on. The email states it. */
export const REMINDER_CONFIRM_TTL_DAYS = 7

/** The shortest gap between two reminders to one member. */
export const REMINDER_MIN_GAP_MS = 6 * DAY_MS

/**
 * The pause between two sends in one run, so a run stays under Resend's
 * per-second rate limit.
 */
const SEND_GAP_MS = 500

/**
 * The fields to write when a member sets their reminder. A weekday switches it
 * on: the consent time and the two tokens are kept if they exist and set if
 * they do not, so changing the day is not new consent. `null` switches it off
 * and clears the consent. The tokens stay for the life of the member row, so
 * the stop link in an older email still works after the member switches the
 * reminder on again. `reminderLastSentAt` is never touched, so switching off
 * and on again cannot send twice in one week, and neither is
 * `reminderConfirmedAt`, which proves the address rather than the consent.
 */
export function reminderUpdate(
  current: {
    reminderConsentAt: Date | null
    reminderToken: string | null
    reminderConfirmToken: string | null
  },
  weekday: ReminderWeekday | null,
  now: Date = new Date(),
) {
  if (weekday === null) {
    return { reminderWeekday: null, reminderConsentAt: null }
  }
  return {
    reminderWeekday: weekday,
    reminderConsentAt: current.reminderConsentAt ?? now,
    reminderToken: current.reminderToken ?? nanoid(32),
    reminderConfirmToken: current.reminderConfirmToken ?? nanoid(32),
  }
}

/**
 * Confirms the address of the member that owns `token` (HON-1113), so the
 * cron starts sending to them.
 *
 * - An unknown token, or a reminder that is off, reads as expired. A
 *   confirmed member who switched it off is not told it is on.
 * - An already confirmed member reads as confirmed, whatever the consent's
 *   age. Mail security gateways open every link before the person does, so a
 *   second open of the same link must not read as expired.
 * - Otherwise the switch-on must be within {@link REMINDER_CONFIRM_TTL_DAYS}.
 *
 * @returns true when the member is confirmed, false for a missing, unknown or
 * expired token, or a reminder that is off.
 */
export async function confirmReminderToken(
  token: string | undefined,
  now: Date = new Date(),
): Promise<boolean> {
  if (!token) return false

  const member = await prisma.householdMember.findUnique({
    where: { reminderConfirmToken: token },
    select: { id: true, reminderWeekday: true, reminderConsentAt: true, reminderConfirmedAt: true },
  })
  if (!member || member.reminderWeekday === null || !member.reminderConsentAt) return false
  if (member.reminderConfirmedAt) return true
  if (member.reminderConsentAt.getTime() < now.getTime() - REMINDER_CONFIRM_TTL_DAYS * DAY_MS) {
    return false
  }

  // Keyed on the reminder being on, so a switch-off since the read above is
  // not confirmed by the link.
  const { count } = await prisma.householdMember.updateMany({
    where: { id: member.id, reminderConfirmToken: token, reminderWeekday: { not: null } },
    data: { reminderConfirmedAt: now },
  })
  return count > 0
}

/** The public page the confirm email links to. */
export function reminderConfirmPageUrl(token: string): string {
  return `${getServerBaseURL()}/reminders/confirm?token=${encodeURIComponent(token)}`
}

/**
 * Sends the confirm email for a member who just switched the reminder on and
 * has not confirmed the address yet. From the `auth` sender, as the waitlist
 * confirmation is: it proves an address, it is not the product email.
 *
 * Throws when Resend rejects the send, so the caller can log it. Without email
 * configured it sends nothing, and prints the link in development.
 */
export async function sendReminderConfirmEmail({
  to,
  userId,
  token,
}: {
  to: string
  userId: string
  token: string
}): Promise<void> {
  const confirmUrl = reminderConfirmPageUrl(token)

  if (!isEmailConfigured() || !resend) {
    // eslint-disable-next-line no-console
    console.warn('Email not configured. Weekly reminder confirm email not sent.')
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.log('Weekly reminder confirm URL:', confirmUrl)
    }
    return
  }

  const locale = await resolveEmailLocale(userId)
  const { subject, html, text } = generateReminderConfirmEmail({
    confirmUrl,
    ttlDays: REMINDER_CONFIRM_TTL_DAYS,
    locale,
  })
  // The SDK reports an API failure in `error` rather than throwing.
  const { error } = await resend.emails.send({
    from: EMAIL_SENDERS.auth,
    to,
    subject: envSubject(subject),
    html,
    text,
  })
  if (error) throw new Error(`Resend rejected the reminder confirm email: ${error.message}`)
}

/**
 * Switches off the reminder that owns `token`, and keeps the token (see
 * `reminderUpdate`). An unknown token, or one whose reminder is already off,
 * changes nothing, and the caller answers the same either way, so the
 * link never tells whether a token existed.
 */
export async function stopRemindersByToken(token: string): Promise<void> {
  await prisma.householdMember.updateMany({
    where: { reminderToken: token },
    data: { reminderWeekday: null, reminderConsentAt: null },
  })
}

/** The public page the email's footer links to. */
export function reminderStopPageUrl(token: string): string {
  return `${getServerBaseURL()}/reminders/stop?token=${encodeURIComponent(token)}`
}

/**
 * The `List-Unsubscribe` target. RFC 8058 mail clients POST to it, which a
 * page cannot take, so it is the API route rather than the page.
 */
export function reminderOneClickUrl(token: string): string {
  return `${getServerBaseURL()}/api/reminders/stop?token=${encodeURIComponent(token)}`
}

export interface WeeklyReminderRunResult {
  sent: number
  skipped: number
  failed: number
}

type Candidate = Awaited<ReturnType<typeof findCandidates>>[number]

function findCandidates() {
  return prisma.householdMember.findMany({
    where: {
      reminderWeekday: { not: null },
      reminderConfirmedAt: { not: null },
      userId: { not: null },
    },
    select: {
      id: true,
      userId: true,
      reminderWeekday: true,
      reminderToken: true,
      reminderLastSentAt: true,
      reminderConfirmedAt: true,
      user: { select: { email: true, deletedAt: true } },
      household: { select: { id: true, timezone: true } },
    },
  })
}

/**
 * Sends today's reminders. One member's failure is captured and counted, and
 * the run goes on. Never sends when email is not configured, as the waitlist
 * does not.
 *
 * No analytics event: the person may not have accepted analytics cookies, and
 * the server must not capture for them.
 */
export async function sendWeeklyReminders(
  now: Date = new Date(),
  { sendGapMs = SEND_GAP_MS }: { sendGapMs?: number } = {},
): Promise<WeeklyReminderRunResult> {
  const result: WeeklyReminderRunResult = { sent: 0, skipped: 0, failed: 0 }
  const configured = isEmailConfigured()
  if (!configured) {
    // eslint-disable-next-line no-console
    console.warn('Email not configured. Weekly reminders not sent.')
  }

  const candidates = await findCandidates()
  for (const member of candidates) {
    try {
      const outcome = await remindMember(member, now, configured)
      result[outcome] += 1
      if (outcome === 'sent' && sendGapMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, sendGapMs))
      }
    } catch (error) {
      result.failed += 1
      captureApiError(error, { route: '/api/cron/weekly-reminders', memberId: member.id })
    }
  }
  return result
}

async function remindMember(
  member: Candidate,
  now: Date,
  configured: boolean,
): Promise<'sent' | 'skipped'> {
  const { user, household, reminderToken: token, reminderLastSentAt: lastSentAt } = member
  // A user in the deletion grace window gets nothing. A member with no token
  // has no stop link, and an email without one is not allowed to go out. An
  // unconfirmed address may not be the member's own (HON-1113); the query
  // already leaves it out, and this keeps the rule next to the send.
  if (!member.userId || !user || user.deletedAt || !token) return 'skipped'
  if (!member.reminderConfirmedAt) return 'skipped'
  if (lastSentAt && now.getTime() - lastSentAt.getTime() < REMINDER_MIN_GAP_MS) return 'skipped'

  const today = getTodayInTimezone(household.timezone, now)
  if (isoWeekday(today) !== member.reminderWeekday) return 'skipped'

  // Any entry next week, in any status, means the household has planned it.
  const { start, end } = nextWeekRange(today)
  const planned = await prisma.mealPlanEntry.count({
    where: { plan: { householdId: household.id }, date: { gte: start, lt: end } },
  })
  if (planned > 0) return 'skipped'

  if (!configured || !resend) return 'skipped'

  // Claim the send before making it. Hobby cron timing drifts by up to an hour,
  // so two overlapping runs must not both pass the gap check above. Keyed on
  // the weekday as well, so a reminder switched off or moved to another day
  // since the read is not sent.
  const { count } = await prisma.householdMember.updateMany({
    where: {
      id: member.id,
      reminderWeekday: member.reminderWeekday,
      OR: [
        { reminderLastSentAt: null },
        { reminderLastSentAt: { lt: new Date(now.getTime() - REMINDER_MIN_GAP_MS) } },
      ],
    },
    data: { reminderLastSentAt: now },
  })
  if (count === 0) return 'skipped'

  try {
    const locale = await resolveEmailLocale(member.userId)
    const { subject, html, text } = generateWeeklyReminderEmail({
      appUrl: `${getServerBaseURL()}/`,
      stopUrl: reminderStopPageUrl(token),
      locale,
    })
    // The SDK reports an API failure in `error` rather than throwing.
    const { error } = await resend.emails.send({
      from: EMAIL_SENDERS.notifications,
      to: user.email,
      subject: envSubject(subject),
      html,
      text,
      // RFC 8058 one-click unsubscribe.
      headers: {
        'List-Unsubscribe': `<${reminderOneClickUrl(token)}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    })
    if (error) throw new Error(`Resend rejected the weekly reminder: ${error.message}`)
  } catch (error) {
    // Give the claim back, so a send that never happened does not count
    // toward the 6-day gap. Keyed on `now`, so a later run's claim is left alone.
    await prisma.householdMember.updateMany({
      where: { id: member.id, reminderLastSentAt: now },
      data: { reminderLastSentAt: lastSentAt },
    })
    throw error
  }
  return 'sent'
}
