import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

// The plan check and the pantry read and delete live in
// `@/lib/shopping/purchase`, tested against a database in
// `purchase.db.test.ts`. This file mocks that module at the seam and asserts
// what the route owns: the session, the household, the body, and the status
// each outcome maps to (HON-1208).

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

vi.mock('@/lib/shopping/purchase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shopping/purchase')>()),
  unpurchasePlanIngredient: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { ShoppingPlanError } from '@/lib/shopping/load-shopping-list'
import { unpurchasePlanIngredient } from '@/lib/shopping/purchase'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockUnpurchase = vi.mocked(unpurchasePlanIngredient)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const membership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: { id: 'household-123', name: 'Test', timezone: 'Europe/Tallinn', locale: 'en' },
} as never

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/meal-plans/plan-123/shopping-list/unpurchase', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'plan-123' }) },
  )
}

async function answer(response: Promise<Response>) {
  const res = await response
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(membership)
})

describe('POST /api/meal-plans/[id]/shopping-list/unpurchase', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(post({ ingredientId: 'ing-rice' }))).toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    })
    expect(mockUnpurchase).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(post({ ingredientId: 'ing-rice' }))).toEqual({
      status: 404,
      body: { error: 'No household found' },
    })
    expect(mockUnpurchase).not.toHaveBeenCalled()
  })

  // The body is checked before the plan, so a bad body never reaches the
  // plan check, whatever the plan (HON-1208).
  it('returns 400 for invalid JSON', async () => {
    expect(await answer(post('not valid json'))).toEqual({
      status: 400,
      body: { error: 'Invalid JSON' },
    })
    expect(mockUnpurchase).not.toHaveBeenCalled()
  })

  it('returns 400 naming ingredientId when it is missing', async () => {
    const { status, body } = await answer(post({}))

    expect(status).toBe(400)
    expect(body.error).toBe('Validation failed')
    expect(Object.keys(body.details)).toEqual(['ingredientId'])
    expect(mockUnpurchase).not.toHaveBeenCalled()
  })

  it("removes the ingredient from the household's pantry", async () => {
    mockUnpurchase.mockResolvedValue('removed')

    expect(await answer(post({ ingredientId: 'ing-rice' }))).toEqual({
      status: 200,
      body: { success: true, ingredientId: 'ing-rice', action: 'removed' },
    })
    expect(mockUnpurchase).toHaveBeenCalledWith('household-123', 'plan-123', 'ing-rice', {
      restoreQuantity: undefined,
    })
  })

  it('passes restoreQuantity through and answers 200 with restored (HON-1438)', async () => {
    mockUnpurchase.mockResolvedValue('restored')

    expect(await answer(post({ ingredientId: 'ing-rice', restoreQuantity: 200 }))).toEqual({
      status: 200,
      body: { success: true, ingredientId: 'ing-rice', action: 'restored' },
    })
    expect(mockUnpurchase).toHaveBeenCalledWith('household-123', 'plan-123', 'ing-rice', {
      restoreQuantity: 200,
    })
  })

  it('answers 200 with has_quantity when the household set an amount after the purchase', async () => {
    mockUnpurchase.mockResolvedValue('has_quantity')

    expect(await answer(post({ ingredientId: 'ing-rice', restoreQuantity: 200 }))).toEqual({
      status: 200,
      body: { success: true, ingredientId: 'ing-rice', action: 'has_quantity' },
    })
  })

  it.each([0, -200, '200'])(
    'returns 400 naming restoreQuantity for %j',
    async (restoreQuantity) => {
      const { status, body } = await answer(post({ ingredientId: 'ing-rice', restoreQuantity }))

      expect(status).toBe(400)
      expect(body.error).toBe('Validation failed')
      expect(Object.keys(body.details)).toEqual(['restoreQuantity'])
      expect(mockUnpurchase).not.toHaveBeenCalled()
    },
  )

  it('sets a staple back to ran out and answers 200 with ran_out', async () => {
    mockUnpurchase.mockResolvedValue('ran_out')

    expect(await answer(post({ ingredientId: 'ing-rice' }))).toEqual({
      status: 200,
      body: { success: true, ingredientId: 'ing-rice', action: 'ran_out' },
    })
  })

  it.each([
    ['not_in_pantry', 404, { error: 'Item not found in pantry' }],
    [
      'too_old',
      400,
      { error: 'Cannot unpurchase items added more than 7 days ago', reason: 'too_old' },
    ],
  ] as const)('answers %s with %i', async (outcome, status, body) => {
    mockUnpurchase.mockResolvedValue(outcome)

    expect(await answer(post({ ingredientId: 'ing-rice' }))).toEqual({ status, body })
  })

  it.each([
    ['planNotFound', 404, 'Meal plan not found'],
    ['otherHousehold', 403, 'Access denied to this meal plan'],
  ] as const)('answers %s with %i, unreported', async (reason, status, error) => {
    mockUnpurchase.mockRejectedValue(new ShoppingPlanError(reason))

    expect(await answer(post({ ingredientId: 'ing-rice' }))).toEqual({ status, body: { error } })
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('reports an unexpected failure and returns 500', async () => {
    const failure = new Error('connection lost')
    mockUnpurchase.mockRejectedValue(failure)

    expect(await answer(post({ ingredientId: 'ing-rice' }))).toEqual({
      status: 500,
      body: { error: 'Failed to unmark item as purchased' },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/meal-plans/[id]/shopping-list/unpurchase',
      userId: 'user-123',
    })
  })
})
