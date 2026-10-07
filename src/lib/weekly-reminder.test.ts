import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/env', () => ({
  serverEnv: { NEXT_PUBLIC_APP_NAME: 'Wobblepot' },
  getServerBaseURL: () => 'https://wobblepot.com',
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    householdMember: { findMany: vi.fn(), updateMany: vi.fn() },
    mealPlanEntry: { count: vi.fn() },
  },
}))

// Mutable, so a test can switch email off.
const resendState = vi.hoisted(() => ({
  configured: true,
  send: vi.fn(),
}))

vi.mock('@/lib/resend', () => ({
  get resend() {
    return resendState.configured ? { emails: { send: resendState.send } } : null
  },
  isEmailConfigured: () => resendState.configured,
  EMAIL_SENDERS: {
    auth: 'Wobblepot <auth@mail.wobblepot.com>',
    notifications: 'Wobblepot <notifications@mail.wobblepot.com>',
  },
  envSubject: (subject: string) => subject,
}))

vi.mock('@/lib/emails/locale', () => ({
  resolveEmailLocale: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { resolveEmailLocale } from '@/lib/emails/locale'
import { captureApiError } from '@/lib/errors'
import { toDateString } from '@/lib/meal-planning/dates'
import {
  REMINDER_MIN_GAP_MS,
  reminderUpdate,
  sendWeeklyReminders,
  stopRemindersByToken,
} from './weekly-reminder'

const mockFindMany = vi.mocked(prisma.householdMember.findMany)
const mockUpdateMany = vi.mocked(prisma.householdMember.updateMany)
const mockEntryCount = vi.mocked(prisma.mealPlanEntry.count)
const mockLocale = vi.mocked(resolveEmailLocale)

// Sunday 11 October 2026, 16:00 UTC: 19:00 in Tallinn, 17:00 in London.
const SUNDAY_RUN = new Date('2026-10-11T16:00:00Z')

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'member-1',
    userId: 'user-1',
    reminderWeekday: 7,
    reminderToken: 'token-1',
    reminderLastSentAt: null as Date | null,
    user: { email: 'pat@example.com', deletedAt: null as Date | null },
    household: { id: 'household-1', timezone: 'Europe/Tallinn' },
    ...overrides,
  }
}

function run(now = SUNDAY_RUN) {
  return sendWeeklyReminders(now, { sendGapMs: 0 })
}

describe('sendWeeklyReminders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resendState.configured = true
    resendState.send.mockResolvedValue({ data: { id: 'email-1' }, error: null })
    mockFindMany.mockResolvedValue([candidate()] as never)
    mockEntryCount.mockResolvedValue(0)
    mockUpdateMany.mockResolvedValue({ count: 1 })
    mockLocale.mockResolvedValue('en')
  })

  it('asks only for members who switched it on and have an account', async () => {
    await run()

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reminderWeekday: { not: null }, userId: { not: null } },
      }),
    )
  })

  it('sends on the chosen weekday when next week is empty', async () => {
    await expect(run()).resolves.toEqual({ sent: 1, skipped: 0, failed: 0 })

    expect(resendState.send).toHaveBeenCalledTimes(1)
    const email = resendState.send.mock.calls[0]![0]
    expect(email.from).toBe('Wobblepot <notifications@mail.wobblepot.com>')
    expect(email.to).toBe('pat@example.com')
    expect(email.subject).toBe('Next week is not planned yet')
    expect(email.html).toContain('href="https://wobblepot.com/reminders/stop?token=token-1"')
  })

  it('carries the one-click unsubscribe headers', async () => {
    await run()

    expect(resendState.send.mock.calls[0]![0].headers).toEqual({
      'List-Unsubscribe': '<https://wobblepot.com/api/reminders/stop?token=token-1>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
  })

  it('writes in the household locale', async () => {
    mockLocale.mockResolvedValue('et')

    await run()

    expect(mockLocale).toHaveBeenCalledWith('user-1')
    expect(resendState.send.mock.calls[0]![0].subject).toBe('Järgmine nädal on veel planeerimata')
  })

  it('checks next week, Monday to Sunday, in the household timezone', async () => {
    await run()

    const { where } = mockEntryCount.mock.calls[0]![0] as {
      where: { plan: { householdId: string }; date: { gte: Date; lt: Date } }
    }
    expect(where.plan).toEqual({ householdId: 'household-1' })
    expect(toDateString(where.date.gte)).toBe('2026-10-12')
    expect(toDateString(where.date.lt)).toBe('2026-10-19')
  })

  it('claims the send with reminderLastSentAt before sending', async () => {
    await run()

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'member-1',
        reminderWeekday: 7,
        OR: [
          { reminderLastSentAt: null },
          { reminderLastSentAt: { lt: new Date(SUNDAY_RUN.getTime() - REMINDER_MIN_GAP_MS) } },
        ],
      },
      data: { reminderLastSentAt: SUNDAY_RUN },
    })
    expect(mockUpdateMany.mock.invocationCallOrder[0]!).toBeLessThan(
      resendState.send.mock.invocationCallOrder[0],
    )
  })

  it('sends nothing when next week has any meal planned', async () => {
    mockEntryCount.mockResolvedValue(1)

    await expect(run()).resolves.toEqual({ sent: 0, skipped: 1, failed: 0 })
    expect(resendState.send).not.toHaveBeenCalled()
  })

  it('sends nothing on another weekday', async () => {
    mockFindMany.mockResolvedValue([candidate({ reminderWeekday: 1 })] as never)

    await expect(run()).resolves.toEqual({ sent: 0, skipped: 1, failed: 0 })
    expect(mockEntryCount).not.toHaveBeenCalled()
  })

  it('reads the weekday in the household timezone, not UTC', async () => {
    // 23:30 UTC on Saturday is already Sunday in Tallinn.
    const saturdayUtc = new Date('2026-10-10T23:30:00Z')

    await expect(run(saturdayUtc)).resolves.toEqual({ sent: 1, skipped: 0, failed: 0 })
  })

  it('sends nothing to a user in the deletion grace window', async () => {
    mockFindMany.mockResolvedValue([
      candidate({ user: { email: 'pat@example.com', deletedAt: new Date('2026-10-01') } }),
    ] as never)

    await expect(run()).resolves.toEqual({ sent: 0, skipped: 1, failed: 0 })
    expect(resendState.send).not.toHaveBeenCalled()
  })

  it('sends nothing when the last reminder went out less than 6 days ago', async () => {
    mockFindMany.mockResolvedValue([
      candidate({ reminderLastSentAt: new Date('2026-10-06T16:00:00Z') }),
    ] as never)

    await expect(run()).resolves.toEqual({ sent: 0, skipped: 1, failed: 0 })
    expect(resendState.send).not.toHaveBeenCalled()
  })

  it('sends again a week after the last one, even when the cron runs earlier in the hour', async () => {
    mockFindMany.mockResolvedValue([
      candidate({ reminderLastSentAt: new Date('2026-10-04T16:59:00Z') }),
    ] as never)

    await expect(run()).resolves.toEqual({ sent: 1, skipped: 0, failed: 0 })
  })

  it('sends nothing without a stop token', async () => {
    mockFindMany.mockResolvedValue([candidate({ reminderToken: null })] as never)

    await expect(run()).resolves.toEqual({ sent: 0, skipped: 1, failed: 0 })
  })

  it('sends nothing when another run claimed the send first', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 })

    await expect(run()).resolves.toEqual({ sent: 0, skipped: 1, failed: 0 })
    expect(resendState.send).not.toHaveBeenCalled()
  })

  it('sends nothing when email is not configured', async () => {
    resendState.configured = false

    await expect(run()).resolves.toEqual({ sent: 0, skipped: 1, failed: 0 })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('gives the claim back and goes on when a send fails', async () => {
    const lastSentAt = new Date('2026-09-27T16:00:00Z')
    mockFindMany.mockResolvedValue([
      candidate({ reminderLastSentAt: lastSentAt }),
      candidate({ id: 'member-2', userId: 'user-2', reminderToken: 'token-2' }),
    ] as never)
    resendState.send
      .mockResolvedValueOnce({
        data: null,
        error: { name: 'rate_limit_exceeded', message: 'Slow down' },
      })
      .mockResolvedValueOnce({ data: { id: 'email-2' }, error: null })

    await expect(run()).resolves.toEqual({ sent: 1, skipped: 0, failed: 1 })

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'member-1', reminderLastSentAt: SUNDAY_RUN },
      data: { reminderLastSentAt: lastSentAt },
    })
    expect(captureApiError).toHaveBeenCalledWith(expect.any(Error), {
      route: '/api/cron/weekly-reminders',
      memberId: 'member-1',
    })
  })
})

describe('reminderUpdate', () => {
  const now = new Date('2026-10-07T12:00:00Z')

  it('switches on with consent now and a new token', () => {
    const update = reminderUpdate({ reminderConsentAt: null, reminderToken: null }, 7, now)

    expect(update.reminderWeekday).toBe(7)
    expect(update.reminderConsentAt).toBe(now)
    expect(update.reminderToken).toMatch(/^[\w-]{32}$/)
  })

  it('keeps the consent time and token when the day changes', () => {
    const consentAt = new Date('2026-09-01')
    const update = reminderUpdate({ reminderConsentAt: consentAt, reminderToken: 'kept' }, 3, now)

    expect(update).toEqual({
      reminderWeekday: 3,
      reminderConsentAt: consentAt,
      reminderToken: 'kept',
    })
  })

  it('clears the day and consent when switched off, and keeps the token and last send', () => {
    const update = reminderUpdate(
      { reminderConsentAt: new Date('2026-09-01'), reminderToken: 'kept' },
      null,
      now,
    )

    expect(update).toEqual({ reminderWeekday: null, reminderConsentAt: null })
    expect(update).not.toHaveProperty('reminderToken')
    expect(update).not.toHaveProperty('reminderLastSentAt')
  })
})

describe('stopRemindersByToken', () => {
  it('switches off the reminder that owns the token, and keeps the token', async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 })

    await stopRemindersByToken('token-1')

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { reminderToken: 'token-1' },
      data: { reminderWeekday: null, reminderConsentAt: null },
    })
  })
})
