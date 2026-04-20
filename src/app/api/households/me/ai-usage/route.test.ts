import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('@/lib/ai/usage', () => ({
  getMonthSpendUsd: vi.fn(),
  getMonthBoundaries: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { getMonthSpendUsd, getMonthBoundaries } from '@/lib/ai/usage'
import { GET } from './route'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockGetSpend = vi.mocked(getMonthSpendUsd)
const mockGetBoundaries = vi.mocked(getMonthBoundaries)

const mockSession = {
  user: { id: 'user-1', name: 'A', email: 'a@b.c' },
  session: { id: 's1' },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/households/me/ai-usage', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET()
    expect(response.status).toBe(401)
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const response = await GET()
    expect(response.status).toBe(404)
  })

  it('returns spend, cap, percentage, and resetAt for the current month', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue({
      household: { id: 'h1', timezone: 'UTC', aiCapUsd: 5 },
    } as never)
    mockGetSpend.mockResolvedValue(2.5)
    mockGetBoundaries.mockReturnValue({
      start: new Date('2026-04-01T00:00:00.000Z'),
      end: new Date('2026-05-01T00:00:00.000Z'),
    })

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      spendUsd: 2.5,
      capUsd: 5,
      percentage: 50,
      resetAt: '2026-05-01T00:00:00.000Z',
    })
  })

  it('handles a household with cap of 0 without dividing by zero', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue({
      household: { id: 'h1', timezone: 'UTC', aiCapUsd: 0 },
    } as never)
    mockGetSpend.mockResolvedValue(0)
    mockGetBoundaries.mockReturnValue({
      start: new Date('2026-04-01T00:00:00.000Z'),
      end: new Date('2026-05-01T00:00:00.000Z'),
    })

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.percentage).toBe(0)
  })
})
