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
  },
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
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockFindUnique = vi.mocked(prisma.mealPlan.findUnique)

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
  new Request('http://localhost/api/meal-plans/plan-123', { method: 'GET' })

const mockPlan = {
  id: 'plan-123',
  householdId: 'household-123',
  entries: [
    {
      id: 'entry-1',
      date: new Date('2026-01-26T00:00:00.000Z'),
      mealType: 'dinner',
      status: 'planned',
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

describe('GET /api/meal-plans/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('returns plan with entries and nutrition on success', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindUnique.mockResolvedValue(mockPlan as never)

    const response = await GET(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.id).toBe('plan-123')
    expect(data.entries).toHaveLength(1)
    expect(data.entries[0].meal.name).toBe('Chicken Rice Bowl')
    expect(data.entries[0].meal.nutrition).toEqual({
      calories: 400,
      protein: 30,
      carbs: 40,
      fat: 15,
    })
    expect(data.entries[0].meal.components).toHaveLength(1)
    expect(data.entries[0].meal.components[0].ingredient.name).toBe('Chicken breast')
  })

  it('handles entry with null meal', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindUnique.mockResolvedValue({
      ...mockPlan,
      entries: [
        {
          id: 'entry-1',
          date: new Date('2026-01-26T00:00:00.000Z'),
          mealType: 'dinner',
          status: 'planned',
          servingOverride: null,
          meal: null,
        },
      ],
    } as never)

    const response = await GET(createRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.entries[0].meal).toBeNull()
  })
})
