import { describe, it, expect, vi, beforeEach } from 'vitest'
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
    mealPlan: {
      findUnique: vi.fn(),
    },
    pantryItem: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/meal-planning/shopping-list', () => ({
  computeShoppingList: vi.fn(),
}))

vi.mock('@/lib/meal-planning/dates', () => ({
  toDateString: vi.fn((d: Date) => d.toISOString().split('T')[0]),
  parseLocalDate: vi.fn(() => new Date('2099-01-26T00:00:00.000Z')),
  getTodayInTimezone: vi.fn(() => '2099-01-26'),
}))

vi.mock('@/lib/i18n/format-dates', () => ({
  formatRelativeDate: vi.fn(() => 'Tomorrow'),
  formatAbsoluteDate: vi.fn(() => 'Mon 27 Jan'),
}))

vi.mock('@/lib/i18n/get-locale', () => ({
  getLocale: vi.fn(() => Promise.resolve('en')),
}))

import { getLocale } from '@/lib/i18n/get-locale'
const mockGetLocale = vi.mocked(getLocale)

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(() => Promise.resolve((key: string) => key)),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { computeShoppingList } from '@/lib/meal-planning/shopping-list'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockFindUnique = vi.mocked(prisma.mealPlan.findUnique)
const mockFindManyPantry = vi.mocked(prisma.pantryItem.findMany)
const mockComputeShoppingList = vi.mocked(computeShoppingList)

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

const createParams = (id: string = 'plan-123') => Promise.resolve({ id })

const createRequest = () =>
  new Request('http://localhost/api/meal-plans/plan-123/shopping-list', { method: 'GET' })

const planCreatedAt = new Date('2099-01-25T10:00:00.000Z')

const mockPlan = {
  id: 'plan-123',
  householdId: 'household-123',
  createdAt: planCreatedAt,
}

describe('GET /api/meal-plans/[id]/shopping-list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default locale (per-test overrides allowed)
    mockGetLocale.mockResolvedValue('en')
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(null)

    const response = await GET(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 404 when plan not found', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindUnique.mockResolvedValue(null)

    const response = await GET(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Meal plan not found')
  })

  it('returns 403 when plan belongs to different household', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindUnique.mockResolvedValue({
      ...mockPlan,
      householdId: 'other-household',
    } as never)

    const response = await GET(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Access denied to this meal plan')
  })

  it('returns formatted shopping list on success', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindUnique.mockResolvedValue(mockPlan as never)

    mockComputeShoppingList.mockResolvedValue([
      {
        category: 'protein',
        categoryLabel: 'Proteins',
        items: [
          {
            ingredientId: 'ing-1',
            ingredient: {
              id: 'ing-1',
              name: 'Chicken breast',
              category: 'protein',
              defaultUnit: 'g',
              gramsPerPiece: null,
            },
            neededQuantity: 600,
            pantryQuantity: null,
            shoppingQuantity: 600,
            mealCount: 2,
            earliestNeededDate: new Date('2099-01-27T00:00:00.000Z'),
            isVague: false,
            originalPhrase: null,
          },
        ],
      },
    ] as never)

    mockFindManyPantry.mockResolvedValue([])

    const response = await GET(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.planId).toBe('plan-123')
    expect(data.generatedAt).toBeDefined()
    expect(data.groups).toHaveLength(1)
    expect(data.groups[0].category).toBe('protein')
    expect(data.groups[0].items).toHaveLength(1)
    expect(data.groups[0].items[0].name).toBe('Chicken breast')
    expect(data.groups[0].items[0].displayQuantity).toBe('600g')
    expect(data.groups[0].items[0].mealCount).toBe(2)
    expect(data.groups[0].items[0].purchased).toBe(false)
    expect(data.summary.totalItems).toBe(1)
    expect(data.summary.purchasedItems).toBe(0)
    expect(data.summary.remainingItems).toBe(1)
  })

  it('marks items as purchased when pantry item updated after plan creation', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindUnique.mockResolvedValue(mockPlan as never)

    mockComputeShoppingList.mockResolvedValue([
      {
        category: 'protein',
        categoryLabel: 'Proteins',
        items: [
          {
            ingredientId: 'ing-1',
            ingredient: {
              id: 'ing-1',
              name: 'Chicken breast',
              category: 'protein',
              defaultUnit: 'g',
              gramsPerPiece: null,
            },
            neededQuantity: 600,
            pantryQuantity: null,
            shoppingQuantity: 600,
            mealCount: 2,
            earliestNeededDate: new Date('2099-01-27T00:00:00.000Z'),
            isVague: false,
            originalPhrase: null,
          },
        ],
      },
    ] as never)

    // Pantry item updated after plan was created
    mockFindManyPantry.mockResolvedValue([
      {
        ingredientId: 'ing-1',
        updatedAt: new Date('2099-01-26T12:00:00.000Z'), // After planCreatedAt
      },
    ] as never)

    const response = await GET(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.groups[0].items[0].purchased).toBe(true)
    expect(data.summary.purchasedItems).toBe(1)
    expect(data.summary.remainingItems).toBe(0)
  })

  it('marks items as not purchased when pantry item updated before plan creation', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindUnique.mockResolvedValue(mockPlan as never)

    mockComputeShoppingList.mockResolvedValue([
      {
        category: 'protein',
        categoryLabel: 'Proteins',
        items: [
          {
            ingredientId: 'ing-1',
            ingredient: {
              id: 'ing-1',
              name: 'Chicken breast',
              category: 'protein',
              defaultUnit: 'g',
              gramsPerPiece: null,
            },
            neededQuantity: 600,
            pantryQuantity: null,
            shoppingQuantity: 600,
            mealCount: 2,
            earliestNeededDate: new Date('2099-01-27T00:00:00.000Z'),
            isVague: false,
            originalPhrase: null,
          },
        ],
      },
    ] as never)

    // Pantry item updated before plan was created
    mockFindManyPantry.mockResolvedValue([
      {
        ingredientId: 'ing-1',
        updatedAt: new Date('2099-01-20T10:00:00.000Z'), // Before planCreatedAt
      },
    ] as never)

    const response = await GET(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.groups[0].items[0].purchased).toBe(false)
  })

  it('formats piece-based ingredients correctly', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindUnique.mockResolvedValue(mockPlan as never)

    mockComputeShoppingList.mockResolvedValue([
      {
        category: 'protein',
        categoryLabel: 'Proteins',
        items: [
          {
            ingredientId: 'ing-2',
            ingredient: {
              id: 'ing-2',
              name: 'Eggs',
              category: 'protein',
              defaultUnit: 'piece',
              gramsPerPiece: 60,
            },
            neededQuantity: 240,
            pantryQuantity: null,
            shoppingQuantity: 240,
            mealCount: 1,
            earliestNeededDate: new Date('2099-01-28T00:00:00.000Z'),
            isVague: false,
            originalPhrase: null,
          },
        ],
      },
    ] as never)

    mockFindManyPantry.mockResolvedValue([])

    const response = await GET(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(200)
    // 240g / 60g per piece = 4 eggs
    expect(data.groups[0].items[0].displayQuantity).toBe('4')
  })

  it('formats vague quantities with original phrase', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindUnique.mockResolvedValue(mockPlan as never)

    mockComputeShoppingList.mockResolvedValue([
      {
        category: 'spice',
        categoryLabel: 'Spices & seasonings',
        items: [
          {
            ingredientId: 'ing-3',
            ingredient: {
              id: 'ing-3',
              name: 'Salt',
              category: 'spice',
              defaultUnit: 'g',
              gramsPerPiece: null,
            },
            neededQuantity: 5,
            pantryQuantity: null,
            shoppingQuantity: 5,
            mealCount: 3,
            earliestNeededDate: new Date('2099-01-27T00:00:00.000Z'),
            isVague: true,
            originalPhrase: 'to taste',
          },
        ],
      },
    ] as never)

    mockFindManyPantry.mockResolvedValue([])

    const response = await GET(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.groups[0].items[0].displayQuantity).toBe('to taste')
    expect(data.groups[0].items[0].isVague).toBe(true)
  })

  it('returns empty groups when shopping list has no items', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindUnique.mockResolvedValue(mockPlan as never)
    mockComputeShoppingList.mockResolvedValue([])
    mockFindManyPantry.mockResolvedValue([])

    const response = await GET(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.groups).toEqual([])
    expect(data.summary.totalItems).toBe(0)
    expect(data.summary.purchasedItems).toBe(0)
    expect(data.summary.remainingItems).toBe(0)
  })

  it('formats kilogram quantities correctly', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindUnique.mockResolvedValue(mockPlan as never)

    mockComputeShoppingList.mockResolvedValue([
      {
        category: 'carb',
        categoryLabel: 'Carbs & grains',
        items: [
          {
            ingredientId: 'ing-4',
            ingredient: {
              id: 'ing-4',
              name: 'Rice',
              category: 'carb',
              defaultUnit: 'g',
              gramsPerPiece: null,
            },
            neededQuantity: 2000,
            pantryQuantity: null,
            shoppingQuantity: 2000,
            mealCount: 5,
            earliestNeededDate: new Date('2099-01-27T00:00:00.000Z'),
            isVague: false,
            originalPhrase: null,
          },
        ],
      },
    ] as never)

    mockFindManyPantry.mockResolvedValue([])

    const response = await GET(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.groups[0].items[0].displayQuantity).toBe('2kg')
  })

  it('uses comma decimal separator in et locale for fractional kg', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindUnique.mockResolvedValue(mockPlan as never)
    mockGetLocale.mockResolvedValue('et')

    mockComputeShoppingList.mockResolvedValue([
      {
        category: 'carb',
        categoryLabel: 'Carbs & grains',
        items: [
          {
            ingredientId: 'ing-rice',
            ingredient: {
              id: 'ing-rice',
              name: 'Rice',
              category: 'carb',
              defaultUnit: 'g',
              gramsPerPiece: null,
            },
            neededQuantity: 1500,
            pantryQuantity: null,
            shoppingQuantity: 1500,
            mealCount: 3,
            earliestNeededDate: new Date('2099-01-27T00:00:00.000Z'),
            isVague: false,
            originalPhrase: null,
          },
        ],
      },
    ] as never)
    mockFindManyPantry.mockResolvedValue([])

    const response = await GET(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.groups[0].items[0].displayQuantity).toBe('1,5kg')
  })
})
