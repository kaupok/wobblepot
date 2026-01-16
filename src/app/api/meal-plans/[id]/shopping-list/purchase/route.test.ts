import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    householdMember: {
      findFirst: vi.fn(),
    },
    mealPlan: {
      findUnique: vi.fn(),
    },
    ingredient: {
      findMany: vi.fn(),
    },
    pantryItem: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockFindUniquePlan = vi.mocked(prisma.mealPlan.findUnique)
const mockFindManyIngredient = vi.mocked(prisma.ingredient.findMany)
const mockFindManyPantry = vi.mocked(prisma.pantryItem.findMany)
const mockTransaction = vi.mocked(prisma.$transaction)

const mockHousehold = {
  id: 'household-123',
  name: 'Test Household',
  timezone: 'Europe/Tallinn',
  preferences: null,
}

const mockMembership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: mockHousehold,
}

const mockPlan = {
  id: 'plan-123',
  householdId: 'household-123',
}

const createRequest = (body: Record<string, unknown>) =>
  new Request('http://localhost/api/meal-plans/plan-123/shopping-list/purchase', {
    method: 'POST',
    body: JSON.stringify(body),
  })

const createParams = () => Promise.resolve({ id: 'plan-123' })

describe('POST /api/meal-plans/[id]/shopping-list/purchase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(null)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 404 when meal plan does not exist', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniquePlan.mockResolvedValue(null)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Meal plan not found')
  })

  it('returns 403 when plan belongs to different household', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniquePlan.mockResolvedValue({
      id: 'plan-123',
      householdId: 'different-household',
    } as never)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Access denied to this meal plan')
  })

  it('returns 400 for invalid JSON', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniquePlan.mockResolvedValue(mockPlan as never)

    const request = new Request('http://localhost/api/meal-plans/plan-123/shopping-list/purchase', {
      method: 'POST',
      body: 'not valid json',
    })

    const response = await POST(request, { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 400 when neither ingredientId nor ingredientIds provided', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniquePlan.mockResolvedValue(mockPlan as never)

    const response = await POST(createRequest({}), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
  })

  it('returns 400 when ingredient does not exist', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniquePlan.mockResolvedValue(mockPlan as never)
    mockFindManyIngredient.mockResolvedValue([])

    const response = await POST(createRequest({ ingredientId: 'nonexistent' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid ingredient IDs')
    expect(data.invalidIds).toEqual(['nonexistent'])
  })

  it('creates new pantry item for single ingredientId', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniquePlan.mockResolvedValue(mockPlan as never)
    mockFindManyIngredient.mockResolvedValue([{ id: 'ing-1' }] as never)
    mockFindManyPantry.mockResolvedValue([])
    const mockDate = new Date('2024-01-15T10:00:00Z')
    mockTransaction.mockImplementation(async (callback) => {
      const mockTx = {
        pantryItem: {
          upsert: vi.fn().mockResolvedValue({
            id: 'pantry-new',
            quantity: null,
            isStaple: false,
            updatedAt: mockDate,
            ingredient: {
              id: 'ing-1',
              name: 'Test Ingredient',
              category: 'PRODUCE',
              defaultUnit: 'g',
            },
          }),
        },
      }
      return callback(mockTx as never)
    })

    const response = await POST(createRequest({ ingredientId: 'ing-1' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.results).toHaveLength(1)
    expect(data.results[0]).toEqual({
      ingredientId: 'ing-1',
      action: 'created',
      pantryItem: {
        id: 'pantry-new',
        quantity: null,
        isStaple: false,
        updatedAt: mockDate.toISOString(),
        ingredient: {
          id: 'ing-1',
          name: 'Test Ingredient',
          category: 'PRODUCE',
          defaultUnit: 'g',
        },
      },
    })
  })

  it('updates existing pantry item', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniquePlan.mockResolvedValue(mockPlan as never)
    mockFindManyIngredient.mockResolvedValue([{ id: 'ing-1' }] as never)
    mockFindManyPantry.mockResolvedValue([
      { id: 'existing-pantry', ingredientId: 'ing-1' },
    ] as never)
    const mockDate = new Date('2024-01-15T10:00:00Z')
    mockTransaction.mockImplementation(async (callback) => {
      const mockTx = {
        pantryItem: {
          upsert: vi.fn().mockResolvedValue({
            id: 'existing-pantry',
            quantity: 500,
            isStaple: true,
            updatedAt: mockDate,
            ingredient: {
              id: 'ing-1',
              name: 'Test Ingredient',
              category: 'PRODUCE',
              defaultUnit: 'g',
            },
          }),
        },
      }
      return callback(mockTx as never)
    })

    const response = await POST(createRequest({ ingredientId: 'ing-1' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.results[0].action).toBe('updated')
    expect(data.results[0].pantryItem.id).toBe('existing-pantry')
  })

  it('processes batch ingredientIds in transaction', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniquePlan.mockResolvedValue(mockPlan as never)
    mockFindManyIngredient.mockResolvedValue([
      { id: 'ing-1' },
      { id: 'ing-2' },
      { id: 'ing-3' },
    ] as never)
    mockFindManyPantry.mockResolvedValue([{ id: 'existing-1', ingredientId: 'ing-2' }] as never)

    const mockDate = new Date('2024-01-15T10:00:00Z')
    let upsertCallCount = 0
    const ingredientNames = ['Ingredient 1', 'Ingredient 2', 'Ingredient 3']
    mockTransaction.mockImplementation(async (callback) => {
      const mockTx = {
        pantryItem: {
          upsert: vi.fn().mockImplementation(() => {
            upsertCallCount++
            return Promise.resolve({
              id: `pantry-${upsertCallCount}`,
              quantity: null,
              isStaple: false,
              updatedAt: mockDate,
              ingredient: {
                id: `ing-${upsertCallCount}`,
                name: ingredientNames[upsertCallCount - 1],
                category: 'PRODUCE',
                defaultUnit: 'g',
              },
            })
          }),
        },
      }
      return callback(mockTx as never)
    })

    const response = await POST(createRequest({ ingredientIds: ['ing-1', 'ing-2', 'ing-3'] }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.results).toHaveLength(3)
    expect(data.results[0].ingredientId).toBe('ing-1')
    expect(data.results[0].action).toBe('created')
    expect(data.results[0].pantryItem.id).toBe('pantry-1')
    expect(data.results[1].ingredientId).toBe('ing-2')
    expect(data.results[1].action).toBe('updated')
    expect(data.results[1].pantryItem.id).toBe('pantry-2')
    expect(data.results[2].ingredientId).toBe('ing-3')
    expect(data.results[2].action).toBe('created')
    expect(data.results[2].pantryItem.id).toBe('pantry-3')
  })

  it('returns 400 when some ingredients in batch do not exist', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniquePlan.mockResolvedValue(mockPlan as never)
    mockFindManyIngredient.mockResolvedValue([{ id: 'ing-1' }] as never)

    const response = await POST(
      createRequest({ ingredientIds: ['ing-1', 'nonexistent-1', 'nonexistent-2'] }),
      {
        params: createParams(),
      },
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid ingredient IDs')
    expect(data.invalidIds).toEqual(['nonexistent-1', 'nonexistent-2'])
  })
})
