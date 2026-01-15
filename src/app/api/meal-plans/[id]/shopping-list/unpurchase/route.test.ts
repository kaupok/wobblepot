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

vi.mock('@/lib/prisma', () => ({
  prisma: {
    householdMember: {
      findFirst: vi.fn(),
    },
    mealPlan: {
      findUnique: vi.fn(),
    },
    pantryItem: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockFindUniquePlan = vi.mocked(prisma.mealPlan.findUnique)
const mockFindUniquePantry = vi.mocked(prisma.pantryItem.findUnique)
const mockDeletePantry = vi.mocked(prisma.pantryItem.delete)

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

const mockPlan = {
  id: 'plan-123',
  householdId: 'household-123',
}

const createRequest = (body: Record<string, unknown>) =>
  new Request('http://localhost/api/meal-plans/plan-123/shopping-list/unpurchase', {
    method: 'POST',
    body: JSON.stringify(body),
  })

const createParams = () => Promise.resolve({ id: 'plan-123' })

describe('POST /api/meal-plans/[id]/shopping-list/unpurchase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T10:00:00.000Z'))
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(null)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 404 when meal plan does not exist', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniquePlan.mockResolvedValue(null)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Meal plan not found')
  })

  it('returns 403 when plan belongs to different household', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniquePlan.mockResolvedValue({
      id: 'plan-123',
      householdId: 'different-household',
    } as never)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Access denied to this meal plan')
  })

  it('returns 400 for invalid JSON', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniquePlan.mockResolvedValue(mockPlan as never)

    const request = new Request(
      'http://localhost/api/meal-plans/plan-123/shopping-list/unpurchase',
      {
        method: 'POST',
        body: 'not valid json',
      },
    )

    const response = await POST(request, { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 400 when ingredientId is missing', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniquePlan.mockResolvedValue(mockPlan as never)

    const response = await POST(createRequest({}), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
  })

  it('returns 404 when item is not in pantry', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniquePlan.mockResolvedValue(mockPlan as never)
    mockFindUniquePantry.mockResolvedValue(null)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Item not found in pantry')
  })

  it('returns 400 when trying to unpurchase a staple item', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniquePlan.mockResolvedValue(mockPlan as never)
    mockFindUniquePantry.mockResolvedValue({
      id: 'pantry-1',
      isStaple: true,
      updatedAt: new Date('2026-01-14'),
    } as never)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Cannot unpurchase staple items')
    expect(data.reason).toBe('staple')
  })

  it('returns 400 when item was added more than 7 days ago', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniquePlan.mockResolvedValue(mockPlan as never)
    mockFindUniquePantry.mockResolvedValue({
      id: 'pantry-1',
      isStaple: false,
      updatedAt: new Date('2026-01-01'), // 14 days ago
    } as never)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Cannot unpurchase items added more than 7 days ago')
    expect(data.reason).toBe('too_old')
  })

  it('successfully removes eligible pantry item', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniquePlan.mockResolvedValue(mockPlan as never)
    mockFindUniquePantry.mockResolvedValue({
      id: 'pantry-1',
      isStaple: false,
      updatedAt: new Date('2026-01-14'), // 1 day ago
    } as never)
    mockDeletePantry.mockResolvedValue({} as never)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.ingredientId).toBe('ing-1')
    expect(data.action).toBe('removed')
    expect(mockDeletePantry).toHaveBeenCalledWith({
      where: { id: 'pantry-1' },
    })
  })

  it('removes item added exactly 7 days ago', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniquePlan.mockResolvedValue(mockPlan as never)
    mockFindUniquePantry.mockResolvedValue({
      id: 'pantry-1',
      isStaple: false,
      updatedAt: new Date('2026-01-08T10:00:00.000Z'), // Exactly 7 days ago
    } as never)
    mockDeletePantry.mockResolvedValue({} as never)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }), {
      params: createParams(),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
  })
})
