import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GET } from './route'

// The read, the purchase status and the formatting live in
// `@/lib/shopping/load-shopping-list`, tested against a database in
// `load-shopping-list.db.test.ts`. This file mocks that module at the seam and
// asserts what the route owns: the session, the household, and the status
// each answer maps to (HON-1208).

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
  loadPlanShoppingList: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { loadPlanShoppingList, ShoppingPlanError } from '@/lib/shopping/load-shopping-list'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockLoadPlanShoppingList = vi.mocked(loadPlanShoppingList)

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
  planId: 'plan-123',
  generatedAt: '2026-10-10T08:00:00.000Z',
  groups: [
    {
      category: 'carb',
      categoryLabel: 'Carbs & grains',
      items: [{ ingredientId: 'ing-rice', name: 'basmatiriis', displayQuantity: '1,5kg' }],
    },
  ],
  summary: { totalItems: 1, purchasedItems: 0, remainingItems: 1 },
}

const get = () =>
  GET(new Request('http://localhost/api/meal-plans/plan-123/shopping-list', { method: 'GET' }), {
    params: Promise.resolve({ id: 'plan-123' }),
  })

async function answer(response: Promise<Response>) {
  const res = await response
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(membership)
})

describe('GET /api/meal-plans/[id]/shopping-list', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(get())).toEqual({ status: 401, body: { error: 'Unauthorized' } })
    expect(mockLoadPlanShoppingList).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(get())).toEqual({ status: 404, body: { error: 'No household found' } })
    expect(mockLoadPlanShoppingList).not.toHaveBeenCalled()
  })

  it("returns the plan's list for the household", async () => {
    mockLoadPlanShoppingList.mockResolvedValue(list as never)

    expect(await answer(get())).toEqual({ status: 200, body: list })
    expect(mockLoadPlanShoppingList).toHaveBeenCalledWith(household, 'plan-123')
  })

  it.each([
    ['planNotFound', 404, 'Meal plan not found'],
    ['otherHousehold', 403, 'Access denied to this meal plan'],
  ] as const)('answers %s with %i, unreported', async (reason, status, error) => {
    mockLoadPlanShoppingList.mockRejectedValue(new ShoppingPlanError(reason))

    expect(await answer(get())).toEqual({ status, body: { error } })
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('reports an unexpected failure and returns 500', async () => {
    const failure = new Error('connection lost')
    mockLoadPlanShoppingList.mockRejectedValue(failure)

    expect(await answer(get())).toEqual({
      status: 500,
      body: { error: 'Failed to fetch shopping list' },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/meal-plans/[id]/shopping-list',
      userId: 'user-123',
    })
  })
})
