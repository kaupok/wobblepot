import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'

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

// The window and the read are `loadRecentMeals`, tested in
// `recent-meals.db.test.ts`. This file asserts the session and the household.
vi.mock('@/lib/meal-plans/recent-meals', () => ({
  loadRecentMeals: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { loadRecentMeals } from '@/lib/meal-plans/recent-meals'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockLoadRecentMeals = vi.mocked(loadRecentMeals)

const household = { id: 'household-1', timezone: 'Europe/Tallinn', locale: 'et' }

describe('GET /api/entries/recent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockGetMembership.mockResolvedValue({ household } as never)
  })

  it('answers 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null as never)
    const response = await GET()
    expect(response.status).toBe(401)
    expect(mockLoadRecentMeals).not.toHaveBeenCalled()
  })

  it('answers 404 without a household', async () => {
    mockGetMembership.mockResolvedValue(null as never)
    const response = await GET()
    expect(response.status).toBe(404)
  })

  it("returns the household's recent meals", async () => {
    const meals = [{ entryId: 'entry-1', mealName: 'Mash', date: '2026-10-20' }]
    mockLoadRecentMeals.mockResolvedValue(meals)

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ meals })
    expect(mockLoadRecentMeals).toHaveBeenCalledWith(household)
  })

  it('answers 500 and reports the error when the read fails', async () => {
    mockLoadRecentMeals.mockRejectedValue(new Error('boom'))
    const response = await GET()
    expect(response.status).toBe(500)
    expect(vi.mocked(captureApiError)).toHaveBeenCalledTimes(1)
  })
})
