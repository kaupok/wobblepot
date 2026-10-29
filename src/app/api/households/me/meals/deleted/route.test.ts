import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GET } from './route'

// Which recipes are listed lives in `listRecentlyDeletedHouseholdMeals`,
// tested against a database in `deleted-household-meals.db.test.ts`. This file
// asserts what the route owns: the session, the household and the body shape
// (HON-1336).

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

vi.mock('@/lib/deleted-household-meals', () => ({
  listRecentlyDeletedHouseholdMeals: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { listRecentlyDeletedHouseholdMeals } from '@/lib/deleted-household-meals'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockList = vi.mocked(listRecentlyDeletedHouseholdMeals)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const mockMembership = { household: { id: 'household-123' } } as never

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(mockMembership)
})

describe('GET /api/households/me/meals/deleted', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET()

    expect(response.status).toBe(401)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('returns 404 when the user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await GET()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No household found' })
  })

  it("answers the household's recently deleted recipes", async () => {
    mockList.mockResolvedValue([
      { id: 'meal-1', name: 'Curry', deletedAt: new Date('2026-10-25T08:00:00.000Z') },
    ])

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      meals: [{ id: 'meal-1', name: 'Curry', deletedAt: '2026-10-25T08:00:00.000Z' }],
    })
    expect(mockList).toHaveBeenCalledWith('household-123')
  })

  it('returns 500 and reports the error when the list throws', async () => {
    const error = new Error('connection lost')
    mockList.mockRejectedValue(error)

    const response = await GET()

    expect(response.status).toBe(500)
    expect(mockCaptureApiError).toHaveBeenCalledWith(error, {
      route: '/api/households/me/meals/deleted',
      userId: 'user-123',
    })
  })
})
