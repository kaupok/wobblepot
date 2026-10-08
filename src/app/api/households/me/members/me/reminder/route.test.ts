import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    householdMember: { findUnique: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
}))

// The real `reminderUpdate`, so the test sees the tokens the route writes.
vi.mock('@/lib/weekly-reminder', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/weekly-reminder')>('@/lib/weekly-reminder')
  return { ...actual, sendReminderConfirmEmail: vi.fn() }
})

import { PATCH } from './route'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { captureApiError } from '@/lib/errors'
import { checkRateLimit } from '@/lib/rate-limit'
import { sendReminderConfirmEmail } from '@/lib/weekly-reminder'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockFindUnique = vi.mocked(prisma.householdMember.findUnique)
const mockUpdate = vi.mocked(prisma.householdMember.update)
const mockRateLimit = vi.mocked(checkRateLimit)
const mockSendConfirm = vi.mocked(sendReminderConfirmEmail)

function member(overrides: Record<string, unknown> = {}) {
  return {
    id: 'member-1',
    reminderWeekday: null,
    reminderConsentAt: null,
    reminderToken: null,
    reminderConfirmToken: null,
    reminderConfirmedAt: null,
    ...overrides,
  }
}

function patch(body: unknown) {
  return PATCH(
    new Request('http://localhost/api/households/me/members/me/reminder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

describe('PATCH /api/households/me/members/me/reminder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'pat@example.com' },
    } as never)
    mockFindUnique.mockResolvedValue(member() as never)
    mockRateLimit.mockResolvedValue({ allowed: true } as never)
    mockSendConfirm.mockResolvedValue(undefined)
  })

  it('returns 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await patch({ weekday: 7 })

    expect(response.status).toBe(401)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 404 without a membership', async () => {
    mockFindUnique.mockResolvedValue(null)

    const response = await patch({ weekday: 7 })

    expect(response.status).toBe(404)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it.each([[0], [8], [1.5], ['7'], [undefined]])('returns 400 for weekday %s', async (weekday) => {
    const response = await patch({ weekday })

    expect(response.status).toBe(400)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 for a body that is not JSON', async () => {
    const response = await patch('not json')

    expect(response.status).toBe(400)
  })

  it("switches on the caller's own reminder, with consent now and a stop token", async () => {
    const response = await patch({ weekday: 3 })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ weekday: 3 })
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    )
    const { where, data } = mockUpdate.mock.calls[0]![0]
    expect(where).toEqual({ id: 'member-1' })
    expect(data).toMatchObject({ reminderWeekday: 3, reminderConsentAt: expect.any(Date) })
    expect(data.reminderToken).toMatch(/^[\w-]{32}$/)
  })

  it('switches it off and clears consent, keeping the token and the last send', async () => {
    mockFindUnique.mockResolvedValue(
      member({
        reminderWeekday: 7,
        reminderConsentAt: new Date('2026-09-01'),
        reminderToken: 'token-1',
      }) as never,
    )

    const response = await patch({ weekday: null })

    expect(response.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'member-1' },
      data: { reminderWeekday: null, reminderConsentAt: null },
    })
    expect(mockSendConfirm).not.toHaveBeenCalled()
  })

  describe('the confirm email (HON-1113)', () => {
    it('sends it once, after the save, to the caller, with the confirm token the save wrote', async () => {
      const response = await patch({ weekday: 7 })

      expect(response.status).toBe(200)
      const { data } = mockUpdate.mock.calls[0]![0]
      expect(data.reminderConfirmToken).toMatch(/^[\w-]{32}$/)
      expect(mockRateLimit).toHaveBeenCalledWith('user-1', 'reminder-confirm')
      expect(mockSendConfirm).toHaveBeenCalledTimes(1)
      expect(mockSendConfirm).toHaveBeenCalledWith({
        to: 'pat@example.com',
        userId: 'user-1',
        token: data.reminderConfirmToken,
      })
      expect(mockUpdate.mock.invocationCallOrder[0]).toBeLessThan(
        mockSendConfirm.mock.invocationCallOrder[0]!,
      )
    })

    it('reuses the existing confirm token when the reminder is switched on again', async () => {
      mockFindUnique.mockResolvedValue(member({ reminderConfirmToken: 'confirm-1' }) as never)

      await patch({ weekday: 2 })

      expect(mockSendConfirm).toHaveBeenCalledWith(expect.objectContaining({ token: 'confirm-1' }))
    })

    it('sends nothing when only the day changes', async () => {
      mockFindUnique.mockResolvedValue(
        member({
          reminderWeekday: 7,
          reminderConsentAt: new Date('2026-10-07'),
          reminderToken: 'token-1',
          reminderConfirmToken: 'confirm-1',
        }) as never,
      )

      const response = await patch({ weekday: 3 })

      expect(response.status).toBe(200)
      expect(mockSendConfirm).not.toHaveBeenCalled()
      expect(mockRateLimit).not.toHaveBeenCalled()
    })

    it('sends nothing when the address was confirmed before', async () => {
      mockFindUnique.mockResolvedValue(
        member({
          reminderToken: 'token-1',
          reminderConfirmToken: 'confirm-1',
          reminderConfirmedAt: new Date('2026-09-01'),
        }) as never,
      )

      const response = await patch({ weekday: 7 })

      expect(response.status).toBe(200)
      expect(mockSendConfirm).not.toHaveBeenCalled()
    })

    it('saves but sends nothing when the rate limit is reached', async () => {
      mockRateLimit.mockResolvedValue({ allowed: false } as never)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const response = await patch({ weekday: 7 })

      expect(response.status).toBe(200)
      expect(mockUpdate).toHaveBeenCalled()
      expect(mockSendConfirm).not.toHaveBeenCalled()
      warn.mockRestore()
    })

    it('saves and logs when the email fails to send', async () => {
      const failure = new Error('Resend down')
      mockSendConfirm.mockRejectedValue(failure)

      const response = await patch({ weekday: 7 })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ weekday: 7 })
      expect(captureApiError).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({ userId: 'user-1', step: 'confirm-email' }),
      )
    })
  })
})
