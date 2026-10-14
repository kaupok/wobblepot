import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

// The read, the purchase status and the formatting live in
// `@/lib/shopping/load-shopping-list`, tested against a database in
// `load-shopping-list.db.test.ts`. This file mocks that module at the seam and
// asserts what the route owns: the session, the household, the `days` query
// parameter, and the status each answer maps to (HON-1208).

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

vi.mock('@/lib/shopping/load-shopping-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shopping/load-shopping-list')>()),
  loadShoppingList: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockLoadShoppingList = vi.mocked(loadShoppingList)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const household = { id: 'household-123', name: 'Test', timezone: 'Europe/Tallinn', locale: 'et' }

const membership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household,
} as never

const list = {
  windowDays: 14,
  startDate: '2026-10-15',
  endDate: '2026-10-28',
  generatedAt: '2026-10-10T08:00:00.000Z',
  hasAnyPlan: true,
  groups: [
    {
      category: 'carb',
      categoryLabel: 'Carbs & grains',
      items: [{ ingredientId: 'ing-rice', name: 'basmatiriis', displayQuantity: '1,5kg' }],
    },
  ],
  customItems: [],
  summary: { totalItems: 1, purchasedItems: 0, remainingItems: 1 },
}

const get = (query = '') => GET(new NextRequest(`http://localhost/api/shopping-list${query}`))

async function answer(response: Promise<Response>) {
  const res = await response
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(membership)
  mockLoadShoppingList.mockResolvedValue(list as never)
})

describe('GET /api/shopping-list', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(get())).toEqual({ status: 401, body: { error: 'Unauthorized' } })
    expect(mockLoadShoppingList).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(get())).toEqual({ status: 404, body: { error: 'No household found' } })
    expect(mockLoadShoppingList).not.toHaveBeenCalled()
  })

  it.each(['?days=3', '?days=abc', '?days=30'])(
    'returns 400 for the days parameter %s',
    async (query) => {
      expect(await answer(get(query))).toEqual({
        status: 400,
        body: { error: 'Invalid days parameter. Must be 7 or 14.' },
      })
      expect(mockLoadShoppingList).not.toHaveBeenCalled()
    },
  )

  it("returns the household's list for 7 days by default", async () => {
    expect(await answer(get())).toEqual({ status: 200, body: list })
    expect(mockLoadShoppingList).toHaveBeenCalledWith(household, { days: 7 })
  })

  it.each([
    ['?days=7', 7],
    ['?days=14', 14],
  ] as const)('passes %s to the read as %i days', async (query, days) => {
    expect(await answer(get(query))).toEqual({ status: 200, body: list })
    expect(mockLoadShoppingList).toHaveBeenCalledWith(household, { days })
  })

  it('reports an unexpected failure and returns 500', async () => {
    const failure = new Error('connection lost')
    mockLoadShoppingList.mockRejectedValue(failure)

    expect(await answer(get())).toEqual({
      status: 500,
      body: { error: 'Failed to fetch shopping list' },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/shopping-list',
      userId: 'user-123',
    })
  })
})
