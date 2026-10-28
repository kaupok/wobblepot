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

// The rule and the read are `loadLeftoverSources`, tested in
// `recent-meals.db.test.ts`. This file asserts the session, the household and
// the slot parameters.
vi.mock('@/lib/meal-plans/recent-meals', () => ({
  loadLeftoverSources: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { loadLeftoverSources } from '@/lib/meal-plans/recent-meals'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockLoadSources = vi.mocked(loadLeftoverSources)

// Two adults and a child at 0.5: the household cooks for 2.5.
const household = {
  id: 'household-1',
  timezone: 'Europe/Tallinn',
  locale: 'et',
  members: [
    { preferences: { portionMultiplier: 1 } },
    { preferences: { portionMultiplier: 1 } },
    { preferences: { portionMultiplier: 0.5 } },
  ],
}

const SLOT_URL = 'http://localhost/api/entries/recent?date=2026-10-22&mealType=lunch'
const get = (url = SLOT_URL) => GET(new Request(url))

describe('GET /api/entries/recent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockGetMembership.mockResolvedValue({ household } as never)
  })

  it('answers 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null as never)
    const response = await get()
    expect(response.status).toBe(401)
    expect(mockLoadSources).not.toHaveBeenCalled()
  })

  it('answers 404 without a household', async () => {
    mockGetMembership.mockResolvedValue(null as never)
    const response = await get()
    expect(response.status).toBe(404)
  })

  it.each([
    ['no slot', 'http://localhost/api/entries/recent'],
    ['a bad date', 'http://localhost/api/entries/recent?date=22.10.2026&mealType=lunch'],
    ['a bad meal type', 'http://localhost/api/entries/recent?date=2026-10-22&mealType=snack'],
  ])('answers 400 for %s', async (_case, url) => {
    const response = await get(url)
    expect(response.status).toBe(400)
    expect(mockLoadSources).not.toHaveBeenCalled()
  })

  it("returns the slot's leftover sources and the household's servings", async () => {
    const meals = [
      {
        entryId: 'entry-1',
        mealName: 'Mash',
        date: '2026-10-21',
        mealType: 'dinner' as const,
        sourceState: 'planned' as const,
      },
    ]
    mockLoadSources.mockResolvedValue(meals)

    const response = await get()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ meals, defaultServings: 2.5 })
    expect(mockLoadSources).toHaveBeenCalledWith(household, {
      date: '2026-10-22',
      mealType: 'lunch',
    })
  })

  it('answers 500 and reports the error when the read fails', async () => {
    mockLoadSources.mockRejectedValue(new Error('boom'))
    const response = await get()
    expect(response.status).toBe(500)
    expect(vi.mocked(captureApiError)).toHaveBeenCalledTimes(1)
  })
})
