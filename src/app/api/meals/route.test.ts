import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GET } from './route'

// The query lives in `@/lib/meals/load-meals`, tested against a database in
// `load-meals.db.test.ts`. This file mocks that module at the seam and asserts
// what the route owns: the session, the household, query-string parsing, and
// the status and body (HON-1211).

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

vi.mock('@/lib/meals/load-meals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meals/load-meals')>()),
  loadMeals: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { loadMeals, type LoadMealsResult } from '@/lib/meals/load-meals'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockLoadMeals = vi.mocked(loadMeals)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const household = {
  id: 'household-123',
  name: 'Test Household',
  timezone: 'Europe/Tallinn',
  locale: 'en',
  preferences: null,
}

const mockMembership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household,
} as never

const RESULT = {
  meals: [{ id: 'meal-1', name: 'Chicken stir fry' }],
  total: 1,
  hasMore: false,
} as unknown as LoadMealsResult

const get = (query = '') => GET(new NextRequest(`http://localhost/api/meals${query}`))

/** The filters the route passed to `loadMeals`. */
const filters = () => mockLoadMeals.mock.calls[0]?.[1]

describe('GET /api/meals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockLoadMeals.mockResolvedValue(RESULT)
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await get()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mockLoadMeals).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await get()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No household found' })
  })

  it("returns loadMeals' page for the caller's household", async () => {
    const response = await get()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(RESULT)
    expect(mockLoadMeals).toHaveBeenCalledWith(household, {
      mealType: null,
      proteinType: null,
      kidFriendly: null,
      search: null,
      source: null,
      order: null,
      limit: 20,
      offset: 0,
    })
  })

  it('passes every filter from the query string', async () => {
    await get(
      '?mealType=dinner&proteinType=poultry&kidFriendly=true&search=chicken&source=favorites&order=longestSinceCooked&limit=10&offset=20',
    )

    expect(filters()).toEqual({
      mealType: 'dinner',
      proteinType: 'poultry',
      kidFriendly: true,
      search: 'chicken',
      source: 'favorites',
      order: 'longestSinceCooked',
      limit: 10,
      offset: 20,
    })
  })

  it.each([
    ['true', true],
    ['false', false],
    ['yes', null],
  ])('reads kidFriendly=%s as %s', async (value, expected) => {
    await get(`?kidFriendly=${value}`)

    expect(filters()?.kidFriendly).toBe(expected)
  })

  it('reads an order it does not know as the default order', async () => {
    await get('?order=random')

    expect(filters()?.order).toBeNull()
  })

  it('falls back to the default page for a limit or offset that is not a number', async () => {
    await get('?limit=abc&offset=xyz')

    expect(filters()).toMatchObject({ limit: 20, offset: 0 })
  })

  it('returns 500 and reports the error when loadMeals throws', async () => {
    mockLoadMeals.mockRejectedValue(new Error('DB down'))

    const response = await get()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to fetch meals' })
    expect(captureApiError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ route: '/api/meals', householdId: 'household-123' }),
    )
  })
})
