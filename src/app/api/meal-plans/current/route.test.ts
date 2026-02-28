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
    mealPlan: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('@/lib/tips', () => ({
  parseStoredTips: vi.fn((stored: string) => {
    try {
      const parsed = JSON.parse(stored)
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.pitfalls) && parsed.tip) {
        return parsed
      }
      return null
    } catch {
      return null
    }
  }),
}))

vi.mock('@/lib/meal-planning/nutrition', () => ({
  computeMealNutrition: vi.fn(() => ({
    calories: 400,
    protein: 30,
    carbs: 40,
    fat: 15,
  })),
}))

vi.mock('@/lib/meal-planning/dates', () => ({
  toDateString: vi.fn((d: Date) => d.toISOString().split('T')[0]),
  getCurrentWeekMonday: vi.fn(() => new Date('2026-01-26T00:00:00.000Z')),
  getLastWeekMonday: vi.fn(() => new Date('2026-01-19T00:00:00.000Z')),
  getNextMonday: vi.fn(() => new Date('2026-02-02T00:00:00.000Z')),
  isSunday: vi.fn(() => false),
  getDaysRemaining: vi.fn(() => 5),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { isSunday } from '@/lib/meal-planning/dates'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockFindFirst = vi.mocked(prisma.mealPlan.findFirst)
const mockIsSunday = vi.mocked(isSunday)

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

const mockPlan = {
  id: 'plan-123',
  householdId: 'household-123',
  startDate: new Date('2026-01-26T00:00:00.000Z'),
  endDate: new Date('2026-02-02T00:00:00.000Z'),
  entries: [
    {
      id: 'entry-1',
      date: new Date('2026-01-26T00:00:00.000Z'),
      mealType: 'dinner',
      status: 'planned',
      preparationTips: null,
      note: null,
      servingOverride: null,
      meal: {
        id: 'meal-1',
        name: 'Chicken Rice Bowl',
        kidFriendly: true,
        timeMinutes: 30,
        primaryProteinType: 'poultry',
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
            },
          },
        ],
      },
    },
  ],
}

function createRequest(url: string = 'http://localhost/api/meal-plans/current') {
  return new NextRequest(url)
}

describe('GET /api/meal-plans/current', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsSunday.mockReturnValue(false)
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

  it('returns 404 with weekContext when no active plan', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindFirst.mockResolvedValue(null)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No active meal plan')
    expect(data.weekContext).toBeDefined()
    expect(data.weekContext.type).toBe('current')
    expect(data.weekContext.daysRemaining).toBe(5)
  })

  it('returns current plan with entries and nutrition', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindFirst.mockResolvedValue(mockPlan as never)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.id).toBe('plan-123')
    expect(data.startDate).toBe('2026-01-26')
    expect(data.entries).toHaveLength(1)
    expect(data.entries[0].meal.name).toBe('Chicken Rice Bowl')
    expect(data.entries[0].meal.nutrition).toBeDefined()
    expect(data.entries[0].meal.components).toHaveLength(1)
    expect(data.weekContext.type).toBe('current')
    expect(data.weekContext.daysCount).toBe(5)
  })

  it('returns next week plan when week=next', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindFirst.mockResolvedValue(mockPlan as never)

    const response = await GET(createRequest('http://localhost/api/meal-plans/current?week=next'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.weekContext.type).toBe('next')
    expect(data.weekContext.daysCount).toBe(7)
  })

  it('returns last week plan when week=last', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindFirst.mockResolvedValue(mockPlan as never)

    const response = await GET(createRequest('http://localhost/api/meal-plans/current?week=last'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.weekContext.type).toBe('last')
    expect(data.weekContext.daysCount).toBe(7)
  })

  it('falls back to next week plan on Sunday when no current plan', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockIsSunday.mockReturnValue(true)
    // First call (current week) returns null, second call (next week) returns plan
    mockFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(mockPlan as never)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.weekContext.type).toBe('next')
  })

  it('handles entry with null meal', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const planWithNullMeal = {
      ...mockPlan,
      entries: [
        {
          id: 'entry-1',
          date: new Date('2026-01-26T00:00:00.000Z'),
          mealType: 'dinner',
          status: 'planned',
          preparationTips: null,
          note: null,
          servingOverride: null,
          meal: null,
        },
      ],
    }
    mockFindFirst.mockResolvedValue(planWithNullMeal as never)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.entries[0].meal).toBeNull()
  })
})
