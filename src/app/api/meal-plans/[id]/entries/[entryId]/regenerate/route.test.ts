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

vi.mock('@/lib/ai/usage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/usage')>()
  return {
    ...actual,
    assertUnderCap: vi.fn(),
  }
})

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { getCandidates } from '@/lib/meal-planning/candidates'
import { assertUnderCap } from '@/lib/ai/usage'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockFindFirstEntry = vi.mocked(prisma.mealPlanEntry.findFirst)
const mockFindManyEntries = vi.mocked(prisma.mealPlanEntry.findMany)
const mockFindManyFavorites = vi.mocked(prisma.favoriteMeal.findMany)
const mockFindManyMeals = vi.mocked(prisma.meal.findMany)
const mockGetCandidates = vi.mocked(getCandidates)
const mockAssertUnderCap = vi.mocked(assertUnderCap)

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
  new Request('http://localhost/api/meal-plans/plan-123/entries/entry-123/regenerate', {
    method: 'POST',
  })

const mockEntry = {
  id: 'entry-123',
  planId: 'plan-123',
  date: new Date('2099-01-28T00:00:00.000Z'),
  mealType: 'dinner',
  mealId: 'meal-current',
  plan: {
    id: 'plan-123',
    householdId: 'household-123',
  },
  meal: {
    id: 'meal-current',
    timeMinutes: 30,
    primaryProteinType: 'poultry',
  },
}

describe('POST /api/meal-plans/[id]/entries/[entryId]/regenerate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAssertUnderCap.mockResolvedValue(undefined)
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

  it('returns 404 when no alternatives available', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindFirstEntry.mockResolvedValue(mockEntry as never)
    mockFindManyEntries.mockResolvedValue([])
    mockFindManyFavorites.mockResolvedValue([])
    mockGetCandidates.mockResolvedValue([])

    const response = await POST(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No alternative meals available matching your preferences')
  })

  it('returns alternatives on success', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindFirstEntry.mockResolvedValue(mockEntry as never)
    mockFindManyEntries.mockResolvedValue([])
    mockFindManyFavorites.mockResolvedValue([])

    const mockCandidates = [
      {
        id: 'meal-alt-1',
        name: 'Salmon Bowl',
        kidFriendly: true,
        primaryProteinType: 'fish',
        topIngredients: [{ name: 'Salmon' }],
        isFavorite: false,
        isCustom: false,
      },
      {
        id: 'meal-alt-2',
        name: 'Beef Stir Fry',
        kidFriendly: false,
        primaryProteinType: 'beef',
        topIngredients: [{ name: 'Beef' }],
        isFavorite: true,
        isCustom: false,
      },
    ]
    mockGetCandidates.mockResolvedValue(mockCandidates as never)

    // Mock timeMinutes lookup
    mockFindManyMeals
      .mockResolvedValueOnce([
        { id: 'meal-alt-1', timeMinutes: 25 },
        { id: 'meal-alt-2', timeMinutes: 35 },
      ] as never)
      // Mock full meal details
      .mockResolvedValueOnce([
        {
          id: 'meal-alt-1',
          name: 'Salmon Bowl',
          description: 'Fresh salmon',
          timeMinutes: 25,
          kidFriendly: true,
          primaryProteinType: 'fish',
          suitableFor: ['dinner'],
          components: [
            {
              ingredientId: 'ing-10',
              quantityPerServing: 200,
              isVague: false,
              originalPhrase: null,
              ingredient: {
                id: 'ing-10',
                name: 'Salmon',
                category: 'protein',
                defaultUnit: 'g',
                gramsPerPiece: null,
              },
            },
          ],
        },
        {
          id: 'meal-alt-2',
          name: 'Beef Stir Fry',
          description: 'Quick stir fry',
          timeMinutes: 35,
          kidFriendly: false,
          primaryProteinType: 'beef',
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

    const alt = data.alternatives[0]
    expect(alt.id).toBeDefined()
    expect(alt.name).toBeDefined()
    expect(alt.reason).toBeDefined()
    expect(alt.nutrition).toBeDefined()
  })

  it('excludes current meal from candidates', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindFirstEntry.mockResolvedValue(mockEntry as never)
    mockFindManyEntries.mockResolvedValue([])
    mockFindManyFavorites.mockResolvedValue([])

    // Return only the current meal as candidate — should result in empty after filtering
    mockGetCandidates.mockResolvedValue([
      {
        id: 'meal-current',
        name: 'Current Meal',
        kidFriendly: true,
        primaryProteinType: 'poultry',
        topIngredients: [],
        isFavorite: false,
        isCustom: false,
      },
    ] as never)

    const response = await POST(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No alternative meals available matching your preferences')
  })
})
