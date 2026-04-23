import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

function createMockRequest(url: string = 'http://localhost/api/shopping-list') {
  return new NextRequest(url)
}

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
    pantryItem: {
      findMany: vi.fn(),
    },
    customShoppingItem: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/meal-planning/shopping-list', () => ({
  computeRollingWindowShoppingList: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { computeRollingWindowShoppingList } from '@/lib/meal-planning/shopping-list'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockPantryFindMany = vi.mocked(prisma.pantryItem.findMany)
const mockCustomItemsFindMany = vi.mocked(prisma.customShoppingItem.findMany)
const mockComputeShoppingList = vi.mocked(computeRollingWindowShoppingList)

const mockHousehold = {
  id: 'household-123',
  name: 'Test Household',
  timezone: 'Europe/Tallinn',
  locale: 'en',
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

describe('GET /api/shopping-list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no custom items
    mockCustomItemsFindMany.mockResolvedValue([])
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET(createMockRequest())
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(null)

    const response = await GET(createMockRequest())
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 400 for invalid days parameter', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)

    const response = await GET(createMockRequest('http://localhost/api/shopping-list?days=3'))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid days parameter. Must be 7 or 14.')
  })

  it('returns empty groups when no planned meals', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockComputeShoppingList.mockResolvedValue({
      groups: [],
      startDate: '2026-01-31',
      endDate: '2026-02-06',
      windowDays: 7,
      earliestPlanCreatedAt: null,
    })
    mockPantryFindMany.mockResolvedValue([])

    const response = await GET(createMockRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.groups).toEqual([])
    expect(data.windowDays).toBe(7)
    expect(data.summary.totalItems).toBe(0)
    expect(data.summary.purchasedItems).toBe(0)
    expect(data.summary.remainingItems).toBe(0)
  })

  it('returns formatted shopping list with purchase status', async () => {
    const neededDate = new Date('2026-02-01')
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockComputeShoppingList.mockResolvedValue({
      groups: [
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
              earliestNeededDate: neededDate,
              isVague: false,
              originalPhrase: null,
            },
          ],
        },
      ],
      startDate: '2026-01-31',
      endDate: '2026-02-06',
      windowDays: 7,
      earliestPlanCreatedAt: new Date('2026-01-30'),
    })
    // No pantry items — item should not be purchased
    mockPantryFindMany.mockResolvedValue([])

    const response = await GET(createMockRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.groups).toHaveLength(1)
    expect(data.groups[0].category).toBe('protein')
    expect(data.groups[0].items).toHaveLength(1)

    const item = data.groups[0].items[0]
    expect(item.name).toBe('Chicken breast')
    expect(item.quantity).toBe(600)
    expect(item.displayQuantity).toBe('600g')
    expect(item.mealCount).toBe(2)
    expect(item.purchased).toBe(false)
    expect(item.neededByDate).toBe('2026-02-01')

    expect(data.summary.totalItems).toBe(1)
    expect(data.summary.purchasedItems).toBe(0)
    expect(data.summary.remainingItems).toBe(1)
  })

  it('marks items as purchased when pantry item exists and was updated after plan creation', async () => {
    const planCreatedAt = new Date('2026-01-30')
    const neededDate = new Date('2026-02-01')

    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockComputeShoppingList.mockResolvedValue({
      groups: [
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
              earliestNeededDate: neededDate,
              isVague: false,
              originalPhrase: null,
            },
          ],
        },
      ],
      startDate: '2026-01-31',
      endDate: '2026-02-06',
      windowDays: 7,
      earliestPlanCreatedAt: planCreatedAt,
    })
    // Pantry item updated after plan creation → purchased
    mockPantryFindMany.mockResolvedValue([
      {
        ingredientId: 'ing-1',
        updatedAt: new Date('2026-01-31'),
      },
    ] as never)

    const response = await GET(createMockRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.groups[0].items[0].purchased).toBe(true)
    expect(data.summary.purchasedItems).toBe(1)
    expect(data.summary.remainingItems).toBe(0)
  })

  it('accepts days=14 parameter', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockComputeShoppingList.mockResolvedValue({
      groups: [],
      startDate: '2026-01-31',
      endDate: '2026-02-13',
      windowDays: 14,
      earliestPlanCreatedAt: null,
    })
    mockPantryFindMany.mockResolvedValue([])

    const response = await GET(createMockRequest('http://localhost/api/shopping-list?days=14'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.windowDays).toBe(14)
    expect(mockComputeShoppingList).toHaveBeenCalledWith(
      'household-123',
      14,
      'Europe/Tallinn',
      'en',
    )
  })

  it('formats piece-based items correctly', async () => {
    const neededDate = new Date('2026-02-01')
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockComputeShoppingList.mockResolvedValue({
      groups: [
        {
          category: 'protein',
          categoryLabel: 'Proteins',
          items: [
            {
              ingredientId: 'ing-eggs',
              ingredient: {
                id: 'ing-eggs',
                name: 'Eggs',
                category: 'protein',
                defaultUnit: 'piece',
                gramsPerPiece: 60,
              },
              neededQuantity: 360,
              pantryQuantity: null,
              shoppingQuantity: 360,
              mealCount: 1,
              earliestNeededDate: neededDate,
              isVague: false,
              originalPhrase: null,
            },
          ],
        },
      ],
      startDate: '2026-01-31',
      endDate: '2026-02-06',
      windowDays: 7,
      earliestPlanCreatedAt: null,
    })
    mockPantryFindMany.mockResolvedValue([])

    const response = await GET(createMockRequest())
    const data = await response.json()

    // 360g / 60g per piece = 6 eggs
    expect(data.groups[0].items[0].displayQuantity).toBe('6')
  })

  it('returns 500 when computation fails', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockComputeShoppingList.mockRejectedValue(new Error('DB error'))

    const response = await GET(createMockRequest())
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch shopping list')
  })
})
