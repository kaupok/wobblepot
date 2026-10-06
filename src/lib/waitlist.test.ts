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
  confirmWaitlistToken,
  confirmedCutoff,
  purgeExpiredWaitlistRequests,
  unconfirmedCutoff,
} from './waitlist'
import { prisma } from '@/lib/prisma'

const mockFindUnique = vi.mocked(prisma.waitlistRequest.findUnique)
const mockUpdateMany = vi.mocked(prisma.waitlistRequest.updateMany)
const mockDeleteMany = vi.mocked(prisma.waitlistRequest.deleteMany)

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

  it('confirms a token within 7 days and clears it', async () => {
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
      data: { confirmedAt: NOW, confirmToken: null },
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

  it('keeps the original confirmedAt when a confirmed row confirms a reissued token', async () => {
    const firstConfirmed = new Date('2026-08-01T09:00:00.000Z')
    mockFindUnique.mockResolvedValue({
      id: 'w1',
      createdAt: new Date(NOW.getTime() - DAY_MS),
      confirmedAt: firstConfirmed,
    } as never)

    expect(await confirmWaitlistToken('tok', NOW)).toBe(true)
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'w1', confirmToken: 'tok' },
      data: { confirmedAt: firstConfirmed, confirmToken: null },
    })
  })

  it('returns false when a concurrent click already used the token', async () => {
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
    expect(mockDeleteMany).toHaveBeenNthCalledWith(2, {
      where: { confirmedAt: { lt: new Date('2026-04-06T12:00:00.000Z') } },
    })
  })
})
