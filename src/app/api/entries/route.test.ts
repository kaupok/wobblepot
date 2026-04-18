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
      findUnique: vi.fn(),
    },
    mealPlanEntry: {
      findMany: vi.fn(),
    },
  },
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockPlanFindUnique = vi.mocked(prisma.mealPlan.findUnique)
const mockEntriesFindMany = vi.mocked(prisma.mealPlanEntry.findMany)

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

function createRequest(
  url = 'http://localhost/api/entries?startDate=2026-02-02&endDate=2026-02-09',
) {
  return new NextRequest(url)
}

describe('GET /api/entries', () => {
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

  it('returns 400 when startDate is missing', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await GET(createRequest('http://localhost/api/entries?endDate=2026-02-09'))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('startDate and endDate')
  })

  it('returns 400 when endDate is missing', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await GET(createRequest('http://localhost/api/entries?startDate=2026-02-02'))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('startDate and endDate')
  })

  it('returns 400 for invalid date format', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await GET(
      createRequest('http://localhost/api/entries?startDate=not-a-date&endDate=2026-02-09'),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid date format. Use YYYY-MM-DD.')
  })

  it('returns 400 for invalid status value', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockPlanFindUnique.mockResolvedValue({ id: 'plan-1', householdId: 'household-123' } as never)

    const response = await GET(
      createRequest(
        'http://localhost/api/entries?startDate=2026-02-02&endDate=2026-02-09&status=bogus',
      ),
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid status value')
  })

  it('returns empty entries when household has no plan yet', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockPlanFindUnique.mockResolvedValue(null)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.entries).toEqual([])
    expect(data.planId).toBeNull()
    expect(mockPlanFindUnique).toHaveBeenCalledWith({
      where: { householdId: 'household-123' },
    })
    expect(mockEntriesFindMany).not.toHaveBeenCalled()
  })

  it('scopes query by the household plan id and date range', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockPlanFindUnique.mockResolvedValue({ id: 'plan-1', householdId: 'household-123' } as never)
    mockEntriesFindMany.mockResolvedValue([])

    await GET(createRequest())

    expect(mockEntriesFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          planId: 'plan-1',
          date: expect.objectContaining({ gte: expect.any(Date), lt: expect.any(Date) }),
        }),
      }),
    )
  })

  it('applies status filter when provided', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockPlanFindUnique.mockResolvedValue({ id: 'plan-1', householdId: 'household-123' } as never)
    mockEntriesFindMany.mockResolvedValue([])

    await GET(
      createRequest(
        'http://localhost/api/entries?startDate=2026-02-02&endDate=2026-02-09&status=planned',
      ),
    )

    expect(mockEntriesFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ planId: 'plan-1', status: 'planned' }),
      }),
    )
  })

  it('returns formatted entries with meal and components', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockPlanFindUnique.mockResolvedValue({ id: 'plan-1', householdId: 'household-123' } as never)

    mockEntriesFindMany.mockResolvedValue([
      {
        id: 'entry-1',
        date: new Date('2026-02-03T00:00:00'),
        mealType: 'dinner',
        status: 'planned',
        rating: null,
        preparationTips: null,
        note: null,
        servingOverride: null,
        meal: {
          id: 'meal-1',
          name: 'Spaghetti Bolognese',
          kidFriendly: true,
          timeMinutes: 45,
          preparationNotes: null,
          primaryProteinType: 'red_meat',
          components: [
            {
              ingredientId: 'ing-1',
              quantityPerServing: 150,
              isVague: false,
              originalPhrase: null,
              ingredient: {
                id: 'ing-1',
                name: 'Ground beef',
                category: 'protein',
                defaultUnit: 'g',
                gramsPerPiece: null,
                calories: 250,
                protein: 26,
                carbs: 0,
                fat: 17,
              },
            },
          ],
        },
      },
    ] as never)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.planId).toBe('plan-1')
    expect(data.entries).toHaveLength(1)
    const entry = data.entries[0]
    expect(entry.id).toBe('entry-1')
    expect(entry.mealType).toBe('dinner')
    expect(entry.status).toBe('planned')
    expect(entry.meal).not.toBeNull()
    expect(entry.meal.name).toBe('Spaghetti Bolognese')
    expect(entry.meal.components).toHaveLength(1)
    expect(entry.meal.components[0].ingredient.name).toBe('Ground beef')
    expect(entry.meal.nutrition).toBeDefined()
  })

  it('parses stored preparationTips when present', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockPlanFindUnique.mockResolvedValue({ id: 'plan-1', householdId: 'household-123' } as never)

    const tips = { pitfalls: ['Over-salt'], tip: 'Stir often' }
    mockEntriesFindMany.mockResolvedValue([
      {
        id: 'entry-1',
        date: new Date('2026-02-03T00:00:00'),
        mealType: 'dinner',
        status: 'planned',
        rating: null,
        preparationTips: JSON.stringify(tips),
        note: null,
        servingOverride: null,
        meal: null,
      },
    ] as never)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.entries[0].preparationTips).toEqual(tips)
    expect(data.entries[0].meal).toBeNull()
  })

  it('handles entries with no meal assigned', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockPlanFindUnique.mockResolvedValue({ id: 'plan-1', householdId: 'household-123' } as never)
    mockEntriesFindMany.mockResolvedValue([
      {
        id: 'entry-empty',
        date: new Date('2026-02-03T00:00:00'),
        mealType: 'dinner',
        status: 'planned',
        rating: null,
        preparationTips: null,
        note: null,
        servingOverride: null,
        meal: null,
      },
    ] as never)

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.entries[0].meal).toBeNull()
  })

  it('returns 500 when Prisma throws', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockPlanFindUnique.mockRejectedValue(new Error('DB down'))

    const response = await GET(createRequest())
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch entries')
  })
})
