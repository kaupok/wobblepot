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
const mockIngredientFindMany = vi.mocked(prisma.ingredient.findMany)
const mockPantryFindMany = vi.mocked(prisma.pantryItem.findMany)
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

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
}

function createRequest(body: unknown) {
  return new Request('http://localhost/api/shopping-list/purchase', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/shopping-list/purchase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }))
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(null)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }))
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 400 for invalid JSON', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)

    const request = new Request('http://localhost/api/shopping-list/purchase', {
      method: 'POST',
      body: 'not valid json',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 400 when neither ingredientId nor ingredientIds provided', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)

    const response = await POST(createRequest({}))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
  })

  it('returns 400 for invalid ingredient IDs', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    // Only ing-1 found, ing-2 is missing
    mockIngredientFindMany.mockResolvedValue([{ id: 'ing-1' }] as never)

    const response = await POST(createRequest({ ingredientIds: ['ing-1', 'ing-2'] }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid ingredient IDs')
    expect(data.invalidIds).toEqual(['ing-2'])
  })

  it('creates pantry items for new ingredients', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockIngredientFindMany.mockResolvedValue([{ id: 'ing-1' }] as never)
    mockPantryFindMany.mockResolvedValue([])

    const mockResult = [
      {
        ingredientId: 'ing-1',
        action: 'created',
        pantryItem: {
          id: 'pantry-new',
          ingredient: { id: 'ing-1', name: 'Chicken', category: 'protein', defaultUnit: 'g' },
          quantity: null,
          isStaple: false,
          updatedAt: new Date('2026-01-31').toISOString(),
        },
      },
    ]
    mockTransaction.mockImplementation(async (fn) => {
      // The route passes a callback to $transaction
      if (typeof fn === 'function') {
        return fn({
          pantryItem: {
            upsert: vi.fn().mockResolvedValue({
              id: 'pantry-new',
              quantity: null,
              isStaple: false,
              updatedAt: new Date('2026-01-31'),
              ingredient: { id: 'ing-1', name: 'Chicken', category: 'protein', defaultUnit: 'g' },
            }),
          },
        } as never)
      }
      return mockResult
    })

    const response = await POST(createRequest({ ingredientId: 'ing-1' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.results).toHaveLength(1)
    expect(data.results[0].ingredientId).toBe('ing-1')
    expect(data.results[0].action).toBe('created')
  })

  it('updates existing pantry items', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockIngredientFindMany.mockResolvedValue([{ id: 'ing-1' }] as never)
    mockPantryFindMany.mockResolvedValue([
      { id: 'pantry-existing', ingredientId: 'ing-1' },
    ] as never)

    mockTransaction.mockImplementation(async (fn) => {
      if (typeof fn === 'function') {
        return fn({
          pantryItem: {
            upsert: vi.fn().mockResolvedValue({
              id: 'pantry-existing',
              quantity: null,
              isStaple: false,
              updatedAt: new Date('2026-01-31'),
              ingredient: { id: 'ing-1', name: 'Chicken', category: 'protein', defaultUnit: 'g' },
            }),
          },
        } as never)
      }
      return []
    })

    const response = await POST(createRequest({ ingredientId: 'ing-1' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.results).toHaveLength(1)
    expect(data.results[0].action).toBe('updated')
  })

  it('supports batch purchase with ingredientIds array', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockIngredientFindMany.mockResolvedValue([{ id: 'ing-1' }, { id: 'ing-2' }] as never)
    mockPantryFindMany.mockResolvedValue([])

    const mockUpsert = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'pantry-1',
        quantity: null,
        isStaple: false,
        updatedAt: new Date('2026-01-31'),
        ingredient: { id: 'ing-1', name: 'Chicken', category: 'protein', defaultUnit: 'g' },
      })
      .mockResolvedValueOnce({
        id: 'pantry-2',
        quantity: null,
        isStaple: false,
        updatedAt: new Date('2026-01-31'),
        ingredient: { id: 'ing-2', name: 'Rice', category: 'carb', defaultUnit: 'g' },
      })

    mockTransaction.mockImplementation(async (fn) => {
      if (typeof fn === 'function') {
        return fn({ pantryItem: { upsert: mockUpsert } } as never)
      }
      return []
    })

    const response = await POST(createRequest({ ingredientIds: ['ing-1', 'ing-2'] }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results).toHaveLength(2)
  })
})
