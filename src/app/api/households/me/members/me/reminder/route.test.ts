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

import { PATCH } from './route'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockFindUnique = vi.mocked(prisma.householdMember.findUnique)
const mockUpdate = vi.mocked(prisma.householdMember.update)

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
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockFindUnique.mockResolvedValue({
      id: 'member-1',
      reminderConsentAt: null,
      reminderToken: null,
    } as never)
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
    mockFindUnique.mockResolvedValue({
      id: 'member-1',
      reminderConsentAt: new Date('2026-09-01'),
      reminderToken: 'token-1',
    } as never)

    const response = await patch({ weekday: null })

    expect(response.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'member-1' },
      data: { reminderWeekday: null, reminderConsentAt: null },
    })
  })
})
