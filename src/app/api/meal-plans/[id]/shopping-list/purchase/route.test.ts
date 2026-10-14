import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

// The plan check, the ingredient scoping and the pantry transaction live in
// `@/lib/shopping/purchase`, tested against a database in
// `purchase.db.test.ts`. This file mocks that module at the seam and asserts
// what the route owns: the session, the household, the body, and the status
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

vi.mock('@/lib/shopping/purchase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shopping/purchase')>()),
  purchasePlanIngredients: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { ShoppingPlanError } from '@/lib/shopping/load-shopping-list'
import { purchasePlanIngredients } from '@/lib/shopping/purchase'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockPurchase = vi.mocked(purchasePlanIngredients)

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

const ricePantryItem = {
  id: 'pantry-rice',
  ingredient: { id: 'ing-rice', name: 'riis', category: 'carb', defaultUnit: 'g' },
  quantity: null,
  isStaple: false,
  updatedAt: '2026-10-15T10:00:00.000Z',
}

const milkPantryItem = {
  id: 'pantry-milk',
  ingredient: { id: 'ing-milk', name: 'piim', category: 'dairy', defaultUnit: 'g' },
  quantity: null,
  isStaple: false,
  updatedAt: '2026-10-15T10:00:00.000Z',
}

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/meal-plans/plan-123/shopping-list/purchase', {
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

describe('POST /api/meal-plans/[id]/shopping-list/purchase', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(post({ ingredientId: 'ing-rice' }))).toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    })
    expect(mockPurchase).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(post({ ingredientId: 'ing-rice' }))).toEqual({
      status: 404,
      body: { error: 'No household found' },
    })
    expect(mockPurchase).not.toHaveBeenCalled()
  })

  // The body is checked before the plan, so a bad body never reaches the
  // plan check, whatever the plan (HON-1208).
  it('returns 400 for invalid JSON', async () => {
    expect(await answer(post('not valid json'))).toEqual({
      status: 400,
      body: { error: 'Invalid JSON' },
    })
    expect(mockPurchase).not.toHaveBeenCalled()
  })

  it('returns 400 when neither ingredientId nor ingredientIds is given', async () => {
    expect(await answer(post({}))).toEqual({
      status: 400,
      body: { error: 'Validation failed', details: {} },
    })
    expect(mockPurchase).not.toHaveBeenCalled()
  })

  it('returns 400 naming ingredientIds for an empty ingredientIds array (HON-659)', async () => {
    const { status, body } = await answer(post({ ingredientIds: [] }))

    expect(status).toBe(400)
    expect(body.error).toBe('Validation failed')
    expect(Object.keys(body.details)).toEqual(['ingredientIds'])
    expect(mockPurchase).not.toHaveBeenCalled()
  })

  it('returns 400 rather than dropping ingredientId when ingredientIds is empty (HON-659)', async () => {
    // `ingredientIds ?? [ingredientId]` would pick the empty array and purchase
    // nothing, so the contradictory request is rejected instead.
    const { status, body } = await answer(post({ ingredientId: 'ing-rice', ingredientIds: [] }))

    expect(status).toBe(400)
    expect(body.error).toBe('Validation failed')
    expect(Object.keys(body.details)).toEqual(['ingredientIds'])
    expect(mockPurchase).not.toHaveBeenCalled()
  })

  it('purchases a single ingredientId and leaves replacedQuantity out of the response', async () => {
    mockPurchase.mockResolvedValue({
      status: 'purchased',
      results: [{ ingredientId: 'ing-rice', replacedQuantity: 300, pantryItem: ricePantryItem }],
    })

    expect(await answer(post({ ingredientId: 'ing-rice' }))).toEqual({
      status: 200,
      body: { success: true, results: [{ ingredientId: 'ing-rice', pantryItem: ricePantryItem }] },
    })
    expect(mockPurchase).toHaveBeenCalledWith(household, 'plan-123', ['ing-rice'])
  })

  it('purchases ingredientIds and returns the results in the order given', async () => {
    mockPurchase.mockResolvedValue({
      status: 'purchased',
      results: [
        { ingredientId: 'ing-milk', replacedQuantity: null, pantryItem: milkPantryItem },
        { ingredientId: 'ing-rice', replacedQuantity: null, pantryItem: ricePantryItem },
        { ingredientId: 'ing-milk', replacedQuantity: null, pantryItem: milkPantryItem },
      ],
    })

    expect(await answer(post({ ingredientIds: ['ing-milk', 'ing-rice', 'ing-milk'] }))).toEqual({
      status: 200,
      body: {
        success: true,
        results: [
          { ingredientId: 'ing-milk', pantryItem: milkPantryItem },
          { ingredientId: 'ing-rice', pantryItem: ricePantryItem },
          { ingredientId: 'ing-milk', pantryItem: milkPantryItem },
        ],
      },
    })
    expect(mockPurchase).toHaveBeenCalledWith(household, 'plan-123', [
      'ing-milk',
      'ing-rice',
      'ing-milk',
    ])
  })

  it('returns 400 with the invalid ids', async () => {
    mockPurchase.mockResolvedValue({ status: 'invalid_ids', invalidIds: ['ing-other-household'] })

    expect(await answer(post({ ingredientIds: ['ing-rice', 'ing-other-household'] }))).toEqual({
      status: 400,
      body: { error: 'Invalid ingredient IDs', invalidIds: ['ing-other-household'] },
    })
  })

  it.each([
    ['planNotFound', 404, 'Meal plan not found'],
    ['otherHousehold', 403, 'Access denied to this meal plan'],
  ] as const)('answers %s with %i, unreported', async (reason, status, error) => {
    mockPurchase.mockRejectedValue(new ShoppingPlanError(reason))

    expect(await answer(post({ ingredientId: 'ing-rice' }))).toEqual({ status, body: { error } })
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('reports an unexpected failure and returns 500', async () => {
    const failure = new Error('connection lost')
    mockPurchase.mockRejectedValue(failure)

    expect(await answer(post({ ingredientId: 'ing-rice' }))).toEqual({
      status: 500,
      body: { error: 'Failed to mark item as purchased' },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/meal-plans/[id]/shopping-list/purchase',
      userId: 'user-123',
    })
  })
})
