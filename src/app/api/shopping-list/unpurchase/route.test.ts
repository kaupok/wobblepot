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
const mockPantryFindUnique = vi.mocked(prisma.pantryItem.findUnique)
const mockPantryDelete = vi.mocked(prisma.pantryItem.delete)

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

function createRequest(body: unknown) {
  return new Request('http://localhost/api/shopping-list/unpurchase', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/shopping-list/unpurchase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }))
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(null)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }))
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 400 for invalid JSON', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)

    const request = new Request('http://localhost/api/shopping-list/unpurchase', {
      method: 'POST',
      body: 'not valid json',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 400 when ingredientId is missing', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)

    const response = await POST(createRequest({}))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
  })

  it('returns 404 when item not in pantry', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockPantryFindUnique.mockResolvedValue(null)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }))
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Item not found in pantry')
  })

  it('returns 400 when trying to unpurchase a staple item', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockPantryFindUnique.mockResolvedValue({
      id: 'pantry-1',
      isStaple: true,
      updatedAt: new Date(),
    } as never)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Cannot unpurchase staple items')
    expect(data.reason).toBe('staple')
  })

  it('returns 400 when item was added more than 7 days ago', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)

    const oldDate = new Date()
    oldDate.setDate(oldDate.getDate() - 8)

    mockPantryFindUnique.mockResolvedValue({
      id: 'pantry-1',
      isStaple: false,
      updatedAt: oldDate,
    } as never)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Cannot unpurchase items added more than 7 days ago')
    expect(data.reason).toBe('too_old')
  })

  it('successfully removes pantry item', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)

    const recentDate = new Date()
    recentDate.setDate(recentDate.getDate() - 1)

    mockPantryFindUnique.mockResolvedValue({
      id: 'pantry-1',
      isStaple: false,
      updatedAt: recentDate,
    } as never)
    mockPantryDelete.mockResolvedValue({} as never)

    const response = await POST(createRequest({ ingredientId: 'ing-1' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.ingredientId).toBe('ing-1')
    expect(data.action).toBe('removed')
    expect(mockPantryDelete).toHaveBeenCalledWith({
      where: { id: 'pantry-1' },
    })
  })
})
