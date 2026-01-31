import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PATCH, DELETE } from './route'

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

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    meal: {
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    ingredient: {
      findMany: vi.fn(),
    },
    mealComponent: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/meal-planning/protein', () => ({
  deriveProteinType: vi.fn(() => 'poultry'),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockMealFindFirst = vi.mocked(prisma.meal.findFirst)
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

const mockMealResult = {
  id: 'meal-1',
  name: 'Chicken Rice Bowl',
  description: 'Simple chicken rice',
  timeMinutes: 30,
  kidFriendly: true,
  primaryProteinType: 'poultry',
  suitableFor: ['dinner'],
  deletedAt: null,
  createdAt: new Date('2026-01-15'),
  updatedAt: new Date('2026-01-15'),
  components: [
    {
      ingredientId: 'ing-1',
      quantityPerServing: 150,
      ingredient: {
        id: 'ing-1',
        name: 'Chicken breast',
        category: 'protein',
        defaultUnit: 'g',
        gramsPerPiece: null,
        calories: 165,
        protein: 31,
        carbs: 0,
        fat: 3.6,
        allergens: [],
      },
    },
  ],
  favoritedBy: [],
}

const paramsPromise = (id: string) => Promise.resolve({ id })

describe('GET /api/households/me/meals/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const request = new NextRequest('http://localhost/api/households/me/meals/meal-1')
    const response = await GET(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const request = new NextRequest('http://localhost/api/households/me/meals/meal-1')
    const response = await GET(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 404 when meal not found', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealFindFirst.mockResolvedValue(null)

    const request = new NextRequest('http://localhost/api/households/me/meals/nonexistent')
    const response = await GET(request, { params: paramsPromise('nonexistent') })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Meal not found')
  })

  it('returns meal with nutrition and allergens', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealFindFirst.mockResolvedValue(mockMealResult as never)

    const request = new NextRequest('http://localhost/api/households/me/meals/meal-1')
    const response = await GET(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.id).toBe('meal-1')
    expect(data.name).toBe('Chicken Rice Bowl')
    expect(data.isCustom).toBe(true)
    expect(data.isFavorite).toBe(false)
    expect(data.nutrition).toBeDefined()
    expect(data.nutrition.calories).toBeGreaterThan(0)
    expect(data.allergens).toEqual([])
    expect(data.components).toHaveLength(1)
  })
})

describe('PATCH /api/households/me/meals/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me/meals/meal-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated' }),
    })
    const response = await PATCH(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 400 for invalid JSON', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)

    const request = new Request('http://localhost/api/households/me/meals/meal-1', {
      method: 'PATCH',
      body: 'not valid json',
    })
    const response = await PATCH(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 400 for validation errors', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)

    const request = new Request('http://localhost/api/households/me/meals/meal-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: '' }), // min length 1
    })
    const response = await PATCH(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me/meals/meal-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated' }),
    })
    const response = await PATCH(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 404 when meal not found', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealFindFirst.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me/meals/nonexistent', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated' }),
    })
    const response = await PATCH(request, { params: paramsPromise('nonexistent') })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Meal not found')
  })

  it('updates meal name successfully', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealFindFirst.mockResolvedValue({ ...mockMealResult, deletedAt: null } as never)

    const updatedMeal = {
      ...mockMealResult,
      name: 'Updated Chicken Bowl',
      updatedAt: new Date(),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (fn: any) => {
      const tx = {
        meal: {
          update: vi.fn(),
          findUniqueOrThrow: vi.fn().mockResolvedValue(updatedMeal),
        },
        mealComponent: {
          deleteMany: vi.fn(),
          createMany: vi.fn(),
        },
      }
      return fn(tx)
    })

    const request = new Request('http://localhost/api/households/me/meals/meal-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated Chicken Bowl' }),
    })
    const response = await PATCH(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.name).toBe('Updated Chicken Bowl')
    expect(data.nutrition).toBeDefined()
  })
})

describe('DELETE /api/households/me/meals/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me/meals/meal-1', {
      method: 'DELETE',
    })
    const response = await DELETE(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me/meals/meal-1', {
      method: 'DELETE',
    })
    const response = await DELETE(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 404 when meal not found', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealFindFirst.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me/meals/nonexistent', {
      method: 'DELETE',
    })
    const response = await DELETE(request, { params: paramsPromise('nonexistent') })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Meal not found')
  })

  it('soft deletes meal successfully', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealFindFirst.mockResolvedValue({ ...mockMealResult, deletedAt: null } as never)
    vi.mocked(prisma.meal.update).mockResolvedValue({} as never)

    const request = new Request('http://localhost/api/households/me/meals/meal-1', {
      method: 'DELETE',
    })
    const response = await DELETE(request, { params: paramsPromise('meal-1') })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(vi.mocked(prisma.meal.update)).toHaveBeenCalledWith({
      where: { id: 'meal-1' },
      data: { deletedAt: expect.any(Date) },
    })
  })
})
