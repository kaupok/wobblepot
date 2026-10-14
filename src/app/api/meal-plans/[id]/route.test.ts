import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'

// The query and the payload shape live in `@/lib/meal-plans/plans`, tested
// against a database in `plans.db.test.ts`. This file mocks that module at the
// seam and asserts what the route owns: the session, the household, the locale,
// and the status each answer maps to (HON-1206).

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

vi.mock('@/lib/meal-plans/plans', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/plans')>()),
  loadMealPlan: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { loadMealPlan, MealPlanReadError } from '@/lib/meal-plans/plans'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockLoadMealPlan = vi.mocked(loadMealPlan)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const membership = (locale = 'en') =>
  ({
    id: 'member-123',
    householdId: 'household-123',
    userId: 'user-123',
    role: 'owner',
    household: { id: 'household-123', name: 'Test', timezone: 'Europe/Tallinn', locale },
  }) as never

const get = () =>
  GET(new Request('http://localhost/api/meal-plans/plan-123', { method: 'GET' }), {
    params: Promise.resolve({ id: 'plan-123' }),
  })

async function answer(response: Promise<Response>) {
  const res = await response
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(membership())
})

describe('GET /api/meal-plans/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(get())).toEqual({ status: 401, body: { error: 'Unauthorized' } })
    expect(mockLoadMealPlan).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(get())).toEqual({ status: 404, body: { error: 'No household found' } })
    expect(mockLoadMealPlan).not.toHaveBeenCalled()
  })

  it("returns the household's plan in the household's locale", async () => {
    mockGetMembership.mockResolvedValue(membership('et'))
    const plan = { id: 'plan-123', entries: [] }
    mockLoadMealPlan.mockResolvedValue(plan as never)

    expect(await answer(get())).toEqual({ status: 200, body: plan })
    expect(mockLoadMealPlan).toHaveBeenCalledWith('household-123', 'plan-123', 'et')
  })

  it.each([
    ['planNotFound', 404, 'Meal plan not found'],
    ['otherHousehold', 403, 'Access denied to this meal plan'],
  ] as const)('answers %s with %i, unreported', async (reason, status, error) => {
    mockLoadMealPlan.mockRejectedValue(new MealPlanReadError(reason))

    expect(await answer(get())).toEqual({ status, body: { error } })
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('reports an unexpected failure and returns 500', async () => {
    const failure = new Error('connection lost')
    mockLoadMealPlan.mockRejectedValue(failure)

    expect(await answer(get())).toEqual({
      status: 500,
      body: { error: 'Failed to fetch meal plan' },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/meal-plans/[id]',
      userId: 'user-123',
    })
  })
})
