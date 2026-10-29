import { beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from './route'

// The ingredient scoping and the pantry transaction live in
// `@/lib/shopping/purchase`, tested against a database in `purchase.db.test.ts`.
// This file mocks that module at the seam and asserts what the route owns: the
// session, the household, the body, and the status each answer maps to
// (HON-1208).

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
  purchaseIngredients: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { purchaseIngredients } from '@/lib/shopping/purchase'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockPurchase = vi.mocked(purchaseIngredients)

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

const rice = {
  ingredientId: 'ing-rice',
  replacedQuantity: 300,
  pantryItem: {
    id: 'pantry-rice',
    ingredient: {
      id: 'ing-rice',
      name: 'riis',
      category: 'carb',
      defaultUnit: 'g',
      displayUnit: 'g' as const,
    },
    quantity: null,
    isStaple: false,
    updatedAt: '2026-10-15T10:00:00.000Z',
  },
}

const milk = {
  ingredientId: 'ing-milk',
  replacedQuantity: null,
  pantryItem: {
    id: 'pantry-milk',
    ingredient: {
      id: 'ing-milk',
      name: 'piim',
      category: 'dairy',
      defaultUnit: 'g',
      displayUnit: 'ml' as const,
    },
    quantity: null,
    isStaple: false,
    updatedAt: '2026-10-15T10:00:00.000Z',
  },
}

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/shopping-list/purchase', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
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

describe('POST /api/shopping-list/purchase', () => {
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

  it('returns 400 naming ingredientId for an empty string', async () => {
    const { status, body } = await answer(post({ ingredientId: '' }))

    expect(status).toBe(400)
    expect(body.error).toBe('Validation failed')
    expect(Object.keys(body.details)).toEqual(['ingredientId'])
    expect(mockPurchase).not.toHaveBeenCalled()
  })

  it('purchases a single ingredientId as a one-item list for the household', async () => {
    mockPurchase.mockResolvedValue({ status: 'purchased', results: [rice] })

    expect(await answer(post({ ingredientId: 'ing-rice' }))).toEqual({
      status: 200,
      body: { success: true, results: [rice] },
    })
    expect(mockPurchase).toHaveBeenCalledWith(household, ['ing-rice'])
  })

  it('purchases ingredientIds in the caller order and returns the results as given', async () => {
    mockPurchase.mockResolvedValue({ status: 'purchased', results: [milk, rice, milk] })

    expect(await answer(post({ ingredientIds: ['ing-milk', 'ing-rice', 'ing-milk'] }))).toEqual({
      status: 200,
      body: { success: true, results: [milk, rice, milk] },
    })
    expect(mockPurchase).toHaveBeenCalledWith(household, ['ing-milk', 'ing-rice', 'ing-milk'])
  })

  it('returns 400 with the invalid ids', async () => {
    mockPurchase.mockResolvedValue({ status: 'invalid_ids', invalidIds: ['ing-other-household'] })

    expect(await answer(post({ ingredientIds: ['ing-rice', 'ing-other-household'] }))).toEqual({
      status: 400,
      body: { error: 'Invalid ingredient IDs', invalidIds: ['ing-other-household'] },
    })
  })

  it('reports an unexpected failure and returns 500', async () => {
    const failure = new Error('connection lost')
    mockPurchase.mockRejectedValue(failure)

    expect(await answer(post({ ingredientId: 'ing-rice' }))).toEqual({
      status: 500,
      body: { error: 'Failed to mark item as purchased' },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(failure, {
      route: '/api/shopping-list/purchase',
      userId: 'user-123',
    })
  })
})
