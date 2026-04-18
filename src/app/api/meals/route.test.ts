import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

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
    favoriteMeal: {
      findMany: vi.fn(),
    },
    meal: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockFavoriteFindMany = vi.mocked(prisma.favoriteMeal.findMany)
const mockMealCount = vi.mocked(prisma.meal.count)
const mockMealFindMany = vi.mocked(prisma.meal.findMany)
const mockQueryRaw = vi.mocked(prisma.$queryRaw)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
}

const mockMembership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: {
    id: 'household-123',
    name: 'Test Household',
    timezone: 'Europe/Tallinn',
    preferences: null,
  },
}

const mockMembershipWithPrefs = {
  ...mockMembership,
  household: {
    ...mockMembership.household,
    preferences: {
      allergensToAvoid: ['gluten'],
      excludedIngredientIds: ['ing-excluded'],
    },
  },
}

function sampleMeal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'meal-1',
    name: 'Chicken stir fry',
    description: null,
    timeMinutes: 30,
    kidFriendly: true,
    primaryProteinType: 'poultry',
    suitableFor: ['dinner'],
    householdId: null,
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
        },
      },
    ],
    favoritedBy: [],
    ...overrides,
  }
}

function createRequest(url = 'http://localhost/api/meals') {
  return new NextRequest(url)
}

describe('GET /api/meals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns system + own household meals by default (source=all)', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(1)
    mockMealFindMany.mockResolvedValue([sampleMeal()] as never)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.meals).toHaveLength(1)
    expect(data.total).toBe(1)
    expect(data.hasMore).toBe(false)

    const whereArg = mockMealFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(whereArg.AND).toContainEqual({
      OR: [{ householdId: null }, { householdId: 'household-123' }],
    })
  })

  it('applies source=system filter', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(0)
    mockMealFindMany.mockResolvedValue([])

    await GET(createRequest('http://localhost/api/meals?source=system'))

    const whereArg = mockMealFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(whereArg.AND).toContainEqual({ householdId: null })
  })

  it('applies source=custom filter scoped to caller household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(0)
    mockMealFindMany.mockResolvedValue([])

    await GET(createRequest('http://localhost/api/meals?source=custom'))

    const whereArg = mockMealFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(whereArg.AND).toContainEqual({ householdId: 'household-123' })
  })

  it('applies source=favorites filter using favorite meal ids', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFavoriteFindMany.mockResolvedValue([
      { mealId: 'meal-fav-1' },
      { mealId: 'meal-fav-2' },
    ] as never)
    mockMealCount.mockResolvedValue(2)
    mockMealFindMany.mockResolvedValue([])

    await GET(createRequest('http://localhost/api/meals?source=favorites'))

    expect(mockFavoriteFindMany).toHaveBeenCalledWith({
      where: { householdId: 'household-123' },
      select: { mealId: true },
    })
    const whereArg = mockMealFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(whereArg.AND).toContainEqual({ id: { in: ['meal-fav-1', 'meal-fav-2'] } })
  })

  it('applies mealType filter', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(0)
    mockMealFindMany.mockResolvedValue([])

    await GET(createRequest('http://localhost/api/meals?mealType=dinner'))

    const whereArg = mockMealFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(whereArg.AND).toContainEqual({ suitableFor: { has: 'dinner' } })
  })

  it('applies proteinType and kidFriendly filters', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(0)
    mockMealFindMany.mockResolvedValue([])

    await GET(createRequest('http://localhost/api/meals?proteinType=poultry&kidFriendly=true'))

    const whereArg = mockMealFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(whereArg.AND).toContainEqual({ primaryProteinType: 'poultry' })
    expect(whereArg.AND).toContainEqual({ kidFriendly: true })
  })

  it('applies allergen hard filter from household preferences', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembershipWithPrefs as never)
    mockMealCount.mockResolvedValue(0)
    mockMealFindMany.mockResolvedValue([])

    await GET(createRequest())

    const whereArg = mockMealFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(whereArg.AND).toContainEqual({
      NOT: {
        components: {
          some: { ingredient: { allergens: { hasSome: ['gluten'] } } },
        },
      },
    })
  })

  it('applies excluded ingredient hard filter', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembershipWithPrefs as never)
    mockMealCount.mockResolvedValue(0)
    mockMealFindMany.mockResolvedValue([])

    await GET(createRequest())

    const whereArg = mockMealFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(whereArg.AND).toContainEqual({
      NOT: {
        components: {
          some: { ingredientId: { in: ['ing-excluded'] } },
        },
      },
    })
  })

  it('runs fuzzy search and orders by similarity when search param is provided', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockQueryRaw.mockResolvedValue([
      { id: 'meal-b', similarity: 0.9 },
      { id: 'meal-a', similarity: 0.5 },
    ] as never)
    mockMealCount.mockResolvedValue(2)
    mockMealFindMany.mockResolvedValue([
      sampleMeal({ id: 'meal-a', name: 'Apple chicken' }),
      sampleMeal({ id: 'meal-b', name: 'Barbecue chicken' }),
    ] as never)

    const response = await GET(createRequest('http://localhost/api/meals?search=chicken'))
    const data = await response.json()

    expect(response.status).toBe(200)
    // Returned meals should be reordered by similarity (meal-b first)
    expect(data.meals[0].id).toBe('meal-b')
    expect(data.meals[1].id).toBe('meal-a')

    const whereArg = mockMealFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(whereArg.AND).toContainEqual({ id: { in: ['meal-b', 'meal-a'] } })
  })

  it('computes nutrition per serving and formats components', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(1)
    mockMealFindMany.mockResolvedValue([sampleMeal()] as never)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    // 150g chicken breast * 165 cal/100g = 247.5 → 248
    expect(data.meals[0].nutrition.calories).toBe(248)
    expect(data.meals[0].nutrition.protein).toBeGreaterThan(0)
    expect(data.meals[0].components[0].ingredient.name).toBe('Chicken breast')
  })

  it('marks isCustom and isFavorite correctly', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(2)
    mockMealFindMany.mockResolvedValue([
      sampleMeal({ id: 'custom-m', householdId: 'household-123', favoritedBy: [{ id: 'fav-1' }] }),
      sampleMeal({ id: 'system-m', householdId: null, favoritedBy: [] }),
    ] as never)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(data.meals[0].isCustom).toBe(true)
    expect(data.meals[0].isFavorite).toBe(true)
    expect(data.meals[1].isCustom).toBe(false)
    expect(data.meals[1].isFavorite).toBe(false)
  })

  it('honors pagination (limit/offset) and hasMore', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(50)
    mockMealFindMany.mockResolvedValue([sampleMeal()] as never)

    const response = await GET(createRequest('http://localhost/api/meals?limit=10&offset=20'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.total).toBe(50)
    expect(data.hasMore).toBe(true)
    expect(mockMealFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }))
  })

  it('excludes deleted meals (deletedAt: null)', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockResolvedValue(0)
    mockMealFindMany.mockResolvedValue([])

    await GET(createRequest())

    const whereArg = mockMealFindMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(whereArg.AND).toContainEqual({ deletedAt: null })
  })

  it('returns 500 when Prisma throws', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockMealCount.mockRejectedValue(new Error('DB down'))

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch meals')
  })
})
