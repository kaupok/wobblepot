import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST, DELETE } from './route'

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
    mealPlanEntry: {
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    meal: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/meal-planning/dates', () => ({
  parseLocalDate: vi.fn((dateStr: string) => new Date(`${dateStr}T00:00:00.000Z`)),
  toDateString: vi.fn((d: Date) => d.toISOString().split('T')[0]),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockFindFirstPlan = vi.mocked(prisma.mealPlan.findFirst)
const mockDeleteManyEntries = vi.mocked(prisma.mealPlanEntry.deleteMany)
const mockFindFirstEntry = vi.mocked(prisma.mealPlanEntry.findFirst)
const mockCreateEntry = vi.mocked(prisma.mealPlanEntry.create)
const mockFindUniqueMeal = vi.mocked(prisma.meal.findUnique)

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

const createPostRequest = (body: Record<string, unknown>) =>
  new Request('http://localhost/api/meal-plans/plan-123/entries', {
    method: 'POST',
    body: JSON.stringify(body),
  })

const createDeleteRequest = (startDate = '2026-01-12', endDate = '2026-01-19') =>
  new Request(
    `http://localhost/api/meal-plans/plan-123/entries?startDate=${startDate}&endDate=${endDate}`,
    { method: 'DELETE' },
  )

describe('DELETE /api/meal-plans/[id]/entries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await DELETE(createDeleteRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(null)

    const response = await DELETE(createDeleteRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 404 when plan not found', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindFirstPlan.mockResolvedValue(null)

    const response = await DELETE(createDeleteRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Meal plan not found')
  })

  it('returns 400 when date range params are missing', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindFirstPlan.mockResolvedValue({
      id: 'plan-123',
    } as never)

    const request = new Request('http://localhost/api/meal-plans/plan-123/entries', {
      method: 'DELETE',
    })
    const response = await DELETE(request, { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('startDate and endDate query params are required')
  })

  it('deletes entries within date range and returns success', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindFirstPlan.mockResolvedValue({
      id: 'plan-123',
    } as never)
    mockDeleteManyEntries.mockResolvedValue({ count: 5 } as never)

    const response = await DELETE(createDeleteRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.deletedCount).toBe(5)
  })
})

describe('POST /api/meal-plans/[id]/entries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await POST(createPostRequest({ date: '2099-01-27', mealType: 'dinner' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(null)

    const response = await POST(createPostRequest({ date: '2099-01-27', mealType: 'dinner' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 400 for invalid JSON', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)

    const request = new Request('http://localhost/api/meal-plans/plan-123/entries', {
      method: 'POST',
      body: 'not json',
    })

    const response = await POST(request, { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 400 for invalid date format', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)

    const response = await POST(createPostRequest({ date: 'not-a-date', mealType: 'dinner' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
  })

  it('returns 400 for invalid mealType', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)

    const response = await POST(createPostRequest({ date: '2099-01-27', mealType: 'snack' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
  })

  it('returns 404 when plan not found', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindFirstPlan.mockResolvedValue(null)

    const response = await POST(createPostRequest({ date: '2099-01-27', mealType: 'dinner' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Plan not found or access denied')
  })

  it('returns 409 when entry already exists for date and mealType', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindFirstPlan.mockResolvedValue({
      id: 'plan-123',
    } as never)
    mockFindFirstEntry.mockResolvedValue({ id: 'existing-entry' } as never)

    const response = await POST(createPostRequest({ date: '2099-01-28', mealType: 'dinner' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Entry already exists for this date and meal type')
  })

  it('returns 404 when specified mealId does not exist', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindFirstPlan.mockResolvedValue({
      id: 'plan-123',
    } as never)
    mockFindFirstEntry.mockResolvedValue(null)
    mockFindUniqueMeal.mockResolvedValue(null)

    const response = await POST(
      createPostRequest({ date: '2099-01-28', mealType: 'dinner', mealId: 'nonexistent' }),
      { params: createParams() },
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Meal not found')
  })

  it('creates entry and returns formatted response on success', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindFirstPlan.mockResolvedValue({
      id: 'plan-123',
    } as never)
    mockFindFirstEntry.mockResolvedValue(null)
    mockFindUniqueMeal.mockResolvedValue({ id: 'meal-1' } as never)
    mockCreateEntry.mockResolvedValue({
      id: 'new-entry',
      date: new Date('2099-01-28T00:00:00.000Z'),
      mealType: 'dinner',
      status: 'planned',
      mealId: 'meal-1',
      note: null,
    } as never)

    const response = await POST(
      createPostRequest({ date: '2099-01-28', mealType: 'dinner', mealId: 'meal-1' }),
      { params: createParams() },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.id).toBe('new-entry')
    expect(data.date).toBe('2099-01-28')
    expect(data.mealType).toBe('dinner')
    expect(data.status).toBe('planned')
    expect(data.mealId).toBe('meal-1')
  })

  it('creates entry without mealId', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindFirstPlan.mockResolvedValue({
      id: 'plan-123',
    } as never)
    mockFindFirstEntry.mockResolvedValue(null)
    mockCreateEntry.mockResolvedValue({
      id: 'new-entry',
      date: new Date('2099-01-28T00:00:00.000Z'),
      mealType: 'dinner',
      status: 'planned',
      mealId: null,
      note: null,
    } as never)

    const response = await POST(createPostRequest({ date: '2099-01-28', mealType: 'dinner' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.mealId).toBeNull()
  })
})
