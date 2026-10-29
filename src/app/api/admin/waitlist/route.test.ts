import { beforeEach, describe, expect, it, vi } from 'vitest'

// The query lives in `@/lib/waitlist` (`listConfirmedWaitlistRequests`),
// tested against a database in `waitlist.db.test.ts`. This file mocks it at
// the seam and asserts the admin gate and the status and body (HON-1217).

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}))
vi.mock('@/lib/errors', () => ({ captureApiError: vi.fn() }))
vi.mock('@/lib/waitlist', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/waitlist')>()),
  listConfirmedWaitlistRequests: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { listConfirmedWaitlistRequests, type WaitlistRow } from '@/lib/waitlist'

import { GET } from './route'

const getSession = vi.mocked(auth.api.getSession)
const mockList = vi.mocked(listConfirmedWaitlistRequests)

const adminSession = { user: { id: 'admin_1', email: 'admin@example.com' } } as never
const userSession = { user: { id: 'user_1', email: 'someone@example.com' } } as never

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/waitlist', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null as never)
    expect((await GET()).status).toBe(401)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('returns 404 for a user who is not the admin', async () => {
    getSession.mockResolvedValue(userSession)
    expect((await GET()).status).toBe(404)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('returns the confirmed requests for the admin', async () => {
    getSession.mockResolvedValue(adminSession)
    const rows: WaitlistRow[] = [
      {
        id: 'w1',
        email: 'anna@example.com',
        locale: 'et',
        source: 'mealime',
        confirmedAt: '2026-10-05T12:00:00.000Z',
        invitedAt: '2026-10-06T08:00:00.000Z',
      },
    ]
    mockList.mockResolvedValue(rows)

    const res = await GET()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ requests: rows })
  })

  it('returns 500 when the query fails', async () => {
    getSession.mockResolvedValue(adminSession)
    mockList.mockRejectedValue(new Error('db down'))

    const res = await GET()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to fetch waitlist requests' })
  })
})
