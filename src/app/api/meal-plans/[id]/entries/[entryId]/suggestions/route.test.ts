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

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mealPlanEntry: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    favoriteMeal: {
      findMany: vi.fn(),
    },
    meal: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/meal-planning/candidates', () => ({
  getCandidates: vi.fn(),
  NO_REPEAT_DAYS: 14,
}))

vi.mock('@/lib/meal-planning/slots', () => ({
  computeRequiredSlots: vi.fn(() => []),
}))

vi.mock('@/lib/meal-planning/dates', () => ({
  getWeekDates: vi.fn(() => []),
  toDateString: vi.fn((d: Date) => d.toISOString().split('T')[0]),
  getMondayOfWeek: vi.fn((d: Date) => {
    const date = new Date(d)
    date.setHours(0, 0, 0, 0)
    const dayOfWeek = date.getDay()
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    date.setDate(date.getDate() - daysSinceMonday)
    return date
  }),
}))

vi.mock('@/lib/meal-planning/pantry', () => ({
  getPantryIngredientNames: vi.fn(() => Promise.resolve([])),
}))

vi.mock('@/lib/meal-planning/nutrition', () => ({
  computeMealNutrition: vi.fn(() => ({
    calories: 350,
    protein: 25,
    carbs: 35,
    fat: 12,
  })),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  retryAfterSeconds: vi.fn(() => 120),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { getCandidates } from '@/lib/meal-planning/candidates'
import { checkRateLimit } from '@/lib/rate-limit'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockFindFirstEntry = vi.mocked(prisma.mealPlanEntry.findFirst)
const mockFindManyEntries = vi.mocked(prisma.mealPlanEntry.findMany)
const mockFindManyFavorites = vi.mocked(prisma.favoriteMeal.findMany)
const mockFindManyMeals = vi.mocked(prisma.meal.findMany)
const mockGetCandidates = vi.mocked(getCandidates)
const mockCheckRateLimit = vi.mocked(checkRateLimit)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const mockMembership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: { id: 'household-123', name: 'Test', timezone: 'Europe/Tallinn', preferences: null },
} as never

const createParams = (id: string = 'plan-123', entryId: string = 'entry-123') =>
  Promise.resolve({ id, entryId })

const createRequest = () =>
  new Request('http://localhost/api/meal-plans/plan-123/entries/entry-123/suggestions', {
    method: 'POST',
  })

const mockEntry = {
  id: 'entry-123',
  planId: 'plan-123',
  date: new Date('2099-01-28T00:00:00.000Z'),
  mealType: 'dinner',
  mealId: null,
  plan: {
    id: 'plan-123',
    householdId: 'household-123',
  },
}

describe('POST /api/meal-plans/[id]/entries/[entryId]/suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 59,
      limit: 60,
      resetAt: new Date('2026-02-01T12:00:00.000Z'),
    })
  })

  it('returns 429 with Retry-After header when rate limited', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      limit: 60,
      resetAt: new Date('2026-02-01T12:00:00.000Z'),
    })

    const response = await POST(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('120')
    expect(data.error).toBe('Rate limit exceeded')
    expect(mockCheckRateLimit).toHaveBeenCalledWith('household-123', 'meal-suggestions')
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await POST(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(null)

    const response = await POST(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 404 when entry not found', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindFirstEntry.mockResolvedValue(null)

    const response = await POST(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Entry not found or access denied')
  })

  it('returns 404 when no candidates available', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindFirstEntry.mockResolvedValue(mockEntry as never)
    mockFindManyEntries.mockResolvedValue([])
    mockFindManyFavorites.mockResolvedValue([])
    mockGetCandidates.mockResolvedValue([])

    const response = await POST(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No meals available matching your preferences')
  })

  it('returns suggestions on success', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindFirstEntry.mockResolvedValue(mockEntry as never)
    mockFindManyEntries.mockResolvedValue([])
    mockFindManyFavorites.mockResolvedValue([])

    const mockCandidates = [
      {
        id: 'meal-1',
        name: 'Pasta Primavera',
        kidFriendly: true,
        primaryProteinType: 'none',
        topIngredients: [{ name: 'Pasta' }],
        isFavorite: true,
        isCustom: false,
      },
      {
        id: 'meal-2',
        name: 'Chicken Curry',
        kidFriendly: false,
        primaryProteinType: 'poultry',
        topIngredients: [{ name: 'Chicken' }],
        isFavorite: false,
        isCustom: true,
      },
    ]
    mockGetCandidates.mockResolvedValue(mockCandidates as never)

    mockFindManyMeals.mockResolvedValue([
      {
        id: 'meal-1',
        name: 'Pasta Primavera',
        description: 'Fresh veggie pasta',
        timeMinutes: 20,
        kidFriendly: true,
        primaryProteinType: 'none',
        suitableFor: ['dinner', 'lunch'],
        components: [
          {
            ingredientId: 'ing-1',
            quantityPerServing: 100,
            isVague: false,
            originalPhrase: null,
            ingredient: {
              id: 'ing-1',
              name: 'Pasta',
              category: 'carb',
              defaultUnit: 'g',
              gramsPerPiece: null,
            },
          },
        ],
      },
      {
        id: 'meal-2',
        name: 'Chicken Curry',
        description: 'Creamy curry',
        timeMinutes: 40,
        kidFriendly: false,
        primaryProteinType: 'poultry',
        suitableFor: ['dinner'],
        components: [],
      },
    ] as never)

    const response = await POST(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.alternatives).toBeDefined()
    expect(data.alternatives.length).toBeLessThanOrEqual(3)
    expect(data.alternatives.length).toBeGreaterThan(0)

    const suggestion = data.alternatives[0]
    expect(suggestion.id).toBeDefined()
    expect(suggestion.name).toBeDefined()
    expect(suggestion.reason).toBeDefined()
    expect(suggestion.nutrition).toBeDefined()
  })

  it('returns at most 3 suggestions', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindFirstEntry.mockResolvedValue(mockEntry as never)
    mockFindManyEntries.mockResolvedValue([])
    mockFindManyFavorites.mockResolvedValue([])

    const mockCandidates = Array.from({ length: 10 }, (_, i) => ({
      id: `meal-${i}`,
      name: `Meal ${i}`,
      kidFriendly: false,
      primaryProteinType: 'poultry',
      topIngredients: [],
      isFavorite: false,
      isCustom: false,
    }))
    mockGetCandidates.mockResolvedValue(mockCandidates as never)

    mockFindManyMeals.mockResolvedValue(
      mockCandidates.slice(0, 3).map((c) => ({
        id: c.id,
        name: c.name,
        description: null,
        timeMinutes: 30,
        kidFriendly: false,
        primaryProteinType: 'poultry',
        suitableFor: ['dinner'],
        components: [],
      })) as never,
    )

    const response = await POST(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.alternatives).toHaveLength(3)
  })
})
