import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/env', () => ({
  serverEnv: { NEXT_PUBLIC_APP_NAME: 'Wobblepot' },
  getServerBaseURL: () => 'https://wobblepot.com',
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    waitlistRequest: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    signupCode: { updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/resend', () => ({
  resend: null,
  isEmailConfigured: () => false,
  EMAIL_SENDERS: { auth: 'Wobblepot <auth@mail.wobblepot.com>' },
  envSubject: (subject: string) => subject,
}))

vi.mock('@/lib/errors', () => ({ captureApiError: vi.fn() }))

import {
  clearWaitlistForNewUser,
  confirmWaitlistToken,
  confirmedCutoff,
  purgeExpiredWaitlistRequests,
  unconfirmedCutoff,
} from './waitlist'
import { prisma } from '@/lib/prisma'

const mockFindUnique = vi.mocked(prisma.waitlistRequest.findUnique)
const mockUpdateMany = vi.mocked(prisma.waitlistRequest.updateMany)
const mockDeleteMany = vi.mocked(prisma.waitlistRequest.deleteMany)
const mockCodeUpdateMany = vi.mocked(prisma.signupCode.updateMany)
const mockUserFindUnique = vi.mocked(prisma.user.findUnique)

const NOW = new Date('2026-10-06T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

describe('waitlist cutoffs', () => {
  it('expires an unconfirmed request exactly 7 days after it was made', () => {
    expect(unconfirmedCutoff(NOW).toISOString()).toBe('2026-09-29T12:00:00.000Z')
  })

  it('keeps a confirmed request for 6 calendar months', () => {
    expect(confirmedCutoff(NOW).toISOString()).toBe('2026-04-06T12:00:00.000Z')
  })
})

describe('confirmWaitlistToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateMany.mockResolvedValue({ count: 1 })
  })

  it('returns false without a lookup for a missing token', async () => {
    expect(await confirmWaitlistToken(undefined, NOW)).toBe(false)
    expect(await confirmWaitlistToken('', NOW)).toBe(false)
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('returns false for an unknown or used token', async () => {
    mockFindUnique.mockResolvedValue(null)

    expect(await confirmWaitlistToken('gone', NOW)).toBe(false)
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('confirms a token within 7 days and keeps it, so the link still works', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'w1',
      createdAt: new Date(NOW.getTime() - 7 * DAY_MS + 1000),
      confirmedAt: null,
    } as never)

    expect(await confirmWaitlistToken('tok', NOW)).toBe(true)
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { confirmToken: 'tok' },
      select: { id: true, createdAt: true, confirmedAt: true },
    })
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'w1', confirmToken: 'tok' },
      data: { confirmedAt: NOW },
    })
  })

  it('refuses a token older than 7 days', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'w1',
      createdAt: new Date(NOW.getTime() - 7 * DAY_MS - 1000),
      confirmedAt: null,
    } as never)

    expect(await confirmWaitlistToken('tok', NOW)).toBe(false)
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('reads a second open of the same link as confirmed and writes nothing', async () => {
    // A mail scanner opened the link at 10:00; the person clicks at 12:00.
    mockFindUnique.mockResolvedValue({
      id: 'w1',
      createdAt: new Date('2026-10-06T09:00:00.000Z'),
      confirmedAt: new Date('2026-10-06T10:00:00.000Z'),
    } as never)

    expect(await confirmWaitlistToken('tok', NOW)).toBe(true)
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('restarts retention when a confirmed person confirms a reissued token', async () => {
    // Confirmed in April, asked again yesterday: the new click is new consent.
    mockFindUnique.mockResolvedValue({
      id: 'w1',
      createdAt: new Date(NOW.getTime() - DAY_MS),
      confirmedAt: new Date('2026-04-08T09:00:00.000Z'),
    } as never)

    expect(await confirmWaitlistToken('tok', NOW)).toBe(true)
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'w1', confirmToken: 'tok' },
      data: { confirmedAt: NOW },
    })
  })

  it('returns false when a resubmit replaced the token after it was read', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'w1',
      createdAt: new Date(NOW.getTime() - DAY_MS),
      confirmedAt: null,
    } as never)
    mockUpdateMany.mockResolvedValue({ count: 0 })

    expect(await confirmWaitlistToken('tok', NOW)).toBe(false)
  })
})

describe('purgeExpiredWaitlistRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes unconfirmed rows past 7 days and confirmed rows past 6 months, and counts each', async () => {
    mockDeleteMany.mockResolvedValueOnce({ count: 4 }).mockResolvedValueOnce({ count: 1 })

    const result = await purgeExpiredWaitlistRequests(NOW)

    expect(result).toEqual({ unconfirmed: 4, confirmed: 1 })
    expect(mockDeleteMany).toHaveBeenNthCalledWith(1, {
      where: { confirmedAt: null, createdAt: { lt: new Date('2026-09-29T12:00:00.000Z') } },
    })
    // Confirmed rows go on `confirmedAt` alone: a resubmit, which anyone can
    // make, resets `createdAt` and must not extend retention.
    expect(mockDeleteMany).toHaveBeenNthCalledWith(2, {
      where: { confirmedAt: { lt: new Date('2026-04-06T12:00:00.000Z') } },
    })
  })
})

describe('clearWaitlistForNewUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockUserFindUnique.mockResolvedValue({ email: ' Anna@Example.com ' } as never)
    mockCodeUpdateMany.mockResolvedValue({ count: 0 })
    mockDeleteMany.mockResolvedValue({ count: 1 })
  })

  it("deletes the request under the new user's email, trimmed and lowercased", async () => {
    await clearWaitlistForNewUser('user_1')

    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      select: { email: true },
    })
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { email: 'anna@example.com' } })
  })

  it("expires an unused code linked to the address's request before deleting it", async () => {
    await clearWaitlistForNewUser('user_1')

    expect(mockCodeUpdateMany).toHaveBeenCalledWith({
      where: { usedAt: null, waitlistRequest: { is: { email: 'anna@example.com' } } },
      data: { expiresAt: expect.any(Date) },
    })
    expect(mockCodeUpdateMany.mock.invocationCallOrder[0]!).toBeLessThan(
      mockDeleteMany.mock.invocationCallOrder[0]!,
    )
  })

  it('does nothing when the user row cannot be read', async () => {
    mockUserFindUnique.mockResolvedValue(null)

    await clearWaitlistForNewUser('user_1')

    expect(mockCodeUpdateMany).not.toHaveBeenCalled()
    expect(mockDeleteMany).not.toHaveBeenCalled()
  })

  it('logs a database error and does not throw, so sign-up still succeeds', async () => {
    const error = new Error('connection lost')
    mockDeleteMany.mockRejectedValue(error)

    await expect(clearWaitlistForNewUser('user_1')).resolves.toBeUndefined()
    expect(console.warn).toHaveBeenCalledWith(
      '[waitlist] failed to delete the waitlist request of a new user',
      { userId: 'user_1', err: error },
    )
  })
})
