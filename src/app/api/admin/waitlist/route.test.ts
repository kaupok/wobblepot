import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { waitlistRequest: { findMany: vi.fn() } },
}))
vi.mock('@/lib/errors', () => ({ captureApiError: vi.fn() }))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { GET } from './route'

const getSession = vi.mocked(auth.api.getSession)
const findMany = prisma.waitlistRequest.findMany as unknown as ReturnType<typeof vi.fn>

const adminSession = { user: { id: 'admin_1', email: 'admin@example.com' } } as never
const userSession = { user: { id: 'user_1', email: 'someone@example.com' } } as never

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/waitlist', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null as never)
    expect((await GET()).status).toBe(401)
  })

  it('returns 404 for a user who is not the admin', async () => {
    getSession.mockResolvedValue(userSession)
    expect((await GET()).status).toBe(404)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('lists confirmed requests only, newest confirmation first', async () => {
    getSession.mockResolvedValue(adminSession)
    findMany.mockResolvedValue([
      {
        id: 'w1',
        email: 'anna@example.com',
        locale: 'et',
        source: 'mealime',
        confirmedAt: new Date('2026-10-05T12:00:00Z'),
        invitedAt: new Date('2026-10-06T08:00:00Z'),
      },
      {
        id: 'w2',
        email: 'ben@example.com',
        locale: 'en',
        source: null,
        confirmedAt: new Date('2026-10-04T12:00:00Z'),
        invitedAt: null,
      },
    ])

    const res = await GET()

    expect(res.status).toBe(200)
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { confirmedAt: { not: null } },
        orderBy: { confirmedAt: 'desc' },
        select: expect.objectContaining({ source: true }),
      }),
    )
    expect(await res.json()).toEqual({
      requests: [
        {
          id: 'w1',
          email: 'anna@example.com',
          locale: 'et',
          source: 'mealime',
          confirmedAt: '2026-10-05T12:00:00.000Z',
          invitedAt: '2026-10-06T08:00:00.000Z',
        },
        {
          id: 'w2',
          email: 'ben@example.com',
          locale: 'en',
          source: null,
          confirmedAt: '2026-10-04T12:00:00.000Z',
          invitedAt: null,
        },
      ],
    })
  })

  it('returns 500 when the query fails', async () => {
    getSession.mockResolvedValue(adminSession)
    findMany.mockRejectedValue(new Error('db down'))
    expect((await GET()).status).toBe(500)
  })
})
