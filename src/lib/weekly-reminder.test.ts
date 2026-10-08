import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/env', () => ({
  serverEnv: { NEXT_PUBLIC_APP_NAME: 'Wobblepot' },
  getServerBaseURL: () => 'https://wobblepot.com',
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    householdMember: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
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
  confirmReminderToken,
  reminderUpdate,
  sendReminderConfirmEmail,
  sendWeeklyReminders,
  stopRemindersByToken,
} from './weekly-reminder'

const mockFindMany = vi.mocked(prisma.householdMember.findMany)
const mockFindUnique = vi.mocked(prisma.householdMember.findUnique)
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
    reminderConfirmedAt: new Date('2026-10-01T10:00:00Z') as Date | null,
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

  it('asks only for members who switched it on, confirmed the address and have an account', async () => {
    await run()

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          reminderWeekday: { not: null },
          reminderConfirmedAt: { not: null },
          userId: { not: null },
        },
      }),
    )
  })

  it('sends nothing to a member who has not confirmed the address', async () => {
    mockFindMany.mockResolvedValue([candidate({ reminderConfirmedAt: null })] as never)

    await expect(run()).resolves.toEqual({ sent: 0, skipped: 1, failed: 0 })
    expect(resendState.send).not.toHaveBeenCalled()
    expect(mockUpdateMany).not.toHaveBeenCalled()
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

  it('switches on with consent now, a new stop token and a separate confirm token', () => {
    const update = reminderUpdate(
      { reminderConsentAt: null, reminderToken: null, reminderConfirmToken: null },
      7,
      now,
    )

    expect(update.reminderWeekday).toBe(7)
    expect(update.reminderConsentAt).toBe(now)
    expect(update.reminderToken).toMatch(/^[\w-]{32}$/)
    expect(update.reminderConfirmToken).toMatch(/^[\w-]{32}$/)
    expect(update.reminderConfirmToken).not.toBe(update.reminderToken)
  })

  it('keeps the consent time and both tokens when the day changes', () => {
    const consentAt = new Date('2026-09-01')
    const update = reminderUpdate(
      { reminderConsentAt: consentAt, reminderToken: 'kept', reminderConfirmToken: 'confirm' },
      3,
      now,
    )

    expect(update).toEqual({
      reminderWeekday: 3,
      reminderConsentAt: consentAt,
      reminderToken: 'kept',
      reminderConfirmToken: 'confirm',
    })
  })

  it('clears the day and consent when switched off, and keeps the tokens, confirmation and last send', () => {
    const update = reminderUpdate(
      {
        reminderConsentAt: new Date('2026-09-01'),
        reminderToken: 'kept',
        reminderConfirmToken: 'c',
      },
      null,
      now,
    )

    expect(update).toEqual({ reminderWeekday: null, reminderConsentAt: null })
    expect(update).not.toHaveProperty('reminderToken')
    expect(update).not.toHaveProperty('reminderConfirmToken')
    expect(update).not.toHaveProperty('reminderConfirmedAt')
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

describe('confirmReminderToken', () => {
  const now = new Date('2026-10-08T12:00:00Z')

  function member(overrides: Record<string, unknown> = {}) {
    return {
      id: 'member-1',
      reminderWeekday: 7,
      reminderConsentAt: new Date('2026-10-05T12:00:00Z'),
      reminderConfirmedAt: null as Date | null,
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateMany.mockResolvedValue({ count: 1 })
  })

  it('confirms a fresh token', async () => {
    mockFindUnique.mockResolvedValue(member() as never)

    await expect(confirmReminderToken('confirm-1', now)).resolves.toBe(true)
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { reminderConfirmToken: 'confirm-1' } }),
    )
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'member-1', reminderConfirmToken: 'confirm-1', reminderWeekday: { not: null } },
      data: { reminderConfirmedAt: now },
    })
  })

  it('still confirms on the last moment of day 7', async () => {
    mockFindUnique.mockResolvedValue(
      member({ reminderConsentAt: new Date('2026-10-01T12:00:00Z') }) as never,
    )

    await expect(confirmReminderToken('confirm-1', now)).resolves.toBe(true)
  })

  it('reads a token more than 7 days after the switch-on as expired, and changes nothing', async () => {
    mockFindUnique.mockResolvedValue(
      member({ reminderConsentAt: new Date('2026-10-01T11:59:59Z') }) as never,
    )

    await expect(confirmReminderToken('confirm-1', now)).resolves.toBe(false)
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('reads an unknown token as expired', async () => {
    mockFindUnique.mockResolvedValue(null)

    await expect(confirmReminderToken('nope', now)).resolves.toBe(false)
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('reads a missing token as expired without a lookup', async () => {
    await expect(confirmReminderToken(undefined, now)).resolves.toBe(false)
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('reads an already confirmed member as confirmed, whatever the consent age, without a write', async () => {
    mockFindUnique.mockResolvedValue(
      member({
        reminderConsentAt: new Date('2026-08-01T00:00:00Z'),
        reminderConfirmedAt: new Date('2026-08-02T00:00:00Z'),
      }) as never,
    )

    await expect(confirmReminderToken('confirm-1', now)).resolves.toBe(true)
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['unconfirmed', null],
    ['confirmed earlier', new Date('2026-09-01T00:00:00Z')],
  ])(
    'reads a switched-off reminder as expired when %s, and changes nothing',
    async (_label, confirmedAt) => {
      mockFindUnique.mockResolvedValue(
        member({
          reminderWeekday: null,
          reminderConsentAt: null,
          reminderConfirmedAt: confirmedAt,
        }) as never,
      )

      await expect(confirmReminderToken('confirm-1', now)).resolves.toBe(false)
      expect(mockUpdateMany).not.toHaveBeenCalled()
    },
  )

  it('reads as expired when the reminder was switched off between the read and the write', async () => {
    mockFindUnique.mockResolvedValue(member() as never)
    mockUpdateMany.mockResolvedValue({ count: 0 })

    await expect(confirmReminderToken('confirm-1', now)).resolves.toBe(false)
  })
})

describe('sendReminderConfirmEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resendState.configured = true
    resendState.send.mockResolvedValue({ data: { id: 'email-1' }, error: null })
    mockLocale.mockResolvedValue('en')
  })

  it('sends the confirm link from the auth sender, in the household locale', async () => {
    mockLocale.mockResolvedValue('et')

    await sendReminderConfirmEmail({ to: 'pat@example.com', userId: 'user-1', token: 'c 1' })

    expect(mockLocale).toHaveBeenCalledWith('user-1')
    const sent = resendState.send.mock.calls[0]![0]
    expect(sent).toMatchObject({
      from: 'Wobblepot <auth@mail.wobblepot.com>',
      to: 'pat@example.com',
      subject: 'Kinnita Wobblepot iganädalane meeldetuletus',
    })
    expect(sent.text).toContain('https://wobblepot.com/reminders/confirm?token=c%201')
    expect(sent).not.toHaveProperty('headers')
  })

  it('throws when Resend rejects the send', async () => {
    resendState.send.mockResolvedValue({ data: null, error: { message: 'bad' } })

    await expect(
      sendReminderConfirmEmail({ to: 'pat@example.com', userId: 'user-1', token: 'c' }),
    ).rejects.toThrow('Resend rejected the reminder confirm email: bad')
  })

  it('sends nothing when email is not configured', async () => {
    resendState.configured = false
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await sendReminderConfirmEmail({ to: 'pat@example.com', userId: 'user-1', token: 'c' })

    expect(resendState.send).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
