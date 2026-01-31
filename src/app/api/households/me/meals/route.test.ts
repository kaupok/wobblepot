import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'

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
      findMany: vi.fn(),
      create: vi.fn(),
    },
    ingredient: {
      findMany: vi.fn(),
    },
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
const mockMealFindMany = vi.mocked(prisma.meal.findMany)
const mockMealCreate = vi.mocked(prisma.meal.create)
const mockIngredientFindMany = vi.mocked(prisma.ingredient.findMany)

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

const mockMealData = {
  id: 'meal-1',
  name: 'Chicken Rice Bowl',
  description: 'A simple chicken and rice dish',
  timeMinutes: 30,
  kidFriendly: true,
  primaryProteinType: 'poultry',
  suitableFor: ['dinner'],
  servings: 2,
  deletedAt: null,
  createdAt: new Date('2026-01-15'),
  updatedAt: new Date('2026-01-15'),
  components: [
    {
      ingredientId: 'ing-1',
      quantityPerServing: 150,
      isVague: false,
      originalPhrase: null,
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
        proteinType: 'poultry',
      },
    },
  ],
  favoritedBy: [],
}

describe('GET /api/households/me/meals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const request = new NextRequest('http://localhost/api/households/me/meals')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const request = new NextRequest('http://localhost/api/households/me/meals')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns meals list with nutrition', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealFindMany.mockResolvedValue([mockMealData] as never)

    const request = new NextRequest('http://localhost/api/households/me/meals')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.meals).toHaveLength(1)
    expect(data.meals[0].name).toBe('Chicken Rice Bowl')
    expect(data.meals[0].nutrition).toBeDefined()
    expect(data.meals[0].nutrition.calories).toBeGreaterThan(0)
    expect(data.meals[0].isCustom).toBe(true)
    expect(data.meals[0].allergens).toEqual([])
  })

  it('returns empty meals array when none exist', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealFindMany.mockResolvedValue([])

    const request = new NextRequest('http://localhost/api/households/me/meals')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.meals).toEqual([])
  })

  it('passes search parameter to query', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealFindMany.mockResolvedValue([])

    const request = new NextRequest('http://localhost/api/households/me/meals?search=chicken')
    await GET(request)

    expect(mockMealFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          name: { contains: 'chicken', mode: 'insensitive' },
        }),
      }),
    )
  })
})

describe('POST /api/households/me/meals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me/meals', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 400 for invalid JSON', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)

    const request = new Request('http://localhost/api/households/me/meals', {
      method: 'POST',
      body: 'not valid json',
    })
    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 400 for validation errors', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)

    const request = new Request('http://localhost/api/households/me/meals', {
      method: 'POST',
      body: JSON.stringify({ name: '' }),
    })
    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details).toBeDefined()
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me/meals', {
      method: 'POST',
      body: JSON.stringify({
        name: 'New Meal',
        suitableFor: ['dinner'],
        servings: 2,
        components: [{ ingredientId: 'ing-1', totalQuantity: 300 }],
      }),
    })
    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 400 when some ingredients not found', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockIngredientFindMany.mockResolvedValue([])

    const request = new Request('http://localhost/api/households/me/meals', {
      method: 'POST',
      body: JSON.stringify({
        name: 'New Meal',
        suitableFor: ['dinner'],
        servings: 2,
        components: [{ ingredientId: 'missing-ing', totalQuantity: 300 }],
      }),
    })
    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Some ingredients not found')
    expect(data.missingIds).toContain('missing-ing')
  })

  it('creates meal successfully and returns 201', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockIngredientFindMany.mockResolvedValue([
      { id: 'ing-1', proteinType: 'poultry', protein: 31 },
    ] as never)

    const createdMeal = {
      id: 'meal-new',
      name: 'New Meal',
      description: null,
      timeMinutes: null,
      kidFriendly: false,
      primaryProteinType: 'poultry',
      suitableFor: ['dinner'],
      servings: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
      components: [
        {
          ingredientId: 'ing-1',
          quantityPerServing: 150,
          isVague: false,
          originalPhrase: null,
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
    }
    mockMealCreate.mockResolvedValue(createdMeal as never)

    const request = new Request('http://localhost/api/households/me/meals', {
      method: 'POST',
      body: JSON.stringify({
        name: 'New Meal',
        suitableFor: ['dinner'],
        servings: 2,
        components: [{ ingredientId: 'ing-1', totalQuantity: 300 }],
      }),
    })
    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.id).toBe('meal-new')
    expect(data.name).toBe('New Meal')
    expect(data.isCustom).toBe(true)
    expect(data.isFavorite).toBe(false)
    expect(data.nutrition).toBeDefined()
    expect(data.allergens).toEqual([])
  })
})
