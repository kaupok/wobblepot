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
    meal: {
      findFirst: vi.fn(),
    },
    favoriteMeal: {
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockFindFirstMeal = vi.mocked(prisma.meal.findFirst)
const mockFindUniqueFavorite = vi.mocked(prisma.favoriteMeal.findUnique)
const mockCreateFavorite = vi.mocked(prisma.favoriteMeal.create)
const mockDeleteManyFavorite = vi.mocked(prisma.favoriteMeal.deleteMany)

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

const createParams = (id: string = 'meal-123') => Promise.resolve({ id })

const createPostRequest = () =>
  new Request('http://localhost/api/meals/meal-123/favorite', { method: 'POST' })

const createDeleteRequest = () =>
  new Request('http://localhost/api/meals/meal-123/favorite', { method: 'DELETE' })

describe('POST /api/meals/[id]/favorite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await POST(createPostRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(null)

    const response = await POST(createPostRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 404 when meal not found', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindFirstMeal.mockResolvedValue(null)

    const response = await POST(createPostRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Meal not found')
  })

  it('returns 409 when meal is already favorited', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindFirstMeal.mockResolvedValue({ id: 'meal-123' } as never)
    mockFindUniqueFavorite.mockResolvedValue({ id: 'fav-1' } as never)

    const response = await POST(createPostRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Meal is already favorited')
  })

  it('creates favorite and returns 201 on success', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockFindFirstMeal.mockResolvedValue({ id: 'meal-123' } as never)
    mockFindUniqueFavorite.mockResolvedValue(null)
    mockCreateFavorite.mockResolvedValue({
      id: 'fav-new',
      householdId: 'household-123',
      mealId: 'meal-123',
    } as never)

    const response = await POST(createPostRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.id).toBe('fav-new')
    expect(data.mealId).toBe('meal-123')
    expect(data.isFavorite).toBe(true)
  })
})

describe('DELETE /api/meals/[id]/favorite', () => {
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

  it('returns 404 when favorite not found', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockDeleteManyFavorite.mockResolvedValue({ count: 0 } as never)

    const response = await DELETE(createDeleteRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Favorite not found')
  })

  it('removes favorite and returns 200 on success', async () => {
    mockGetSession.mockResolvedValue(mockSession)
    mockGetMembership.mockResolvedValue(mockMembership)
    mockDeleteManyFavorite.mockResolvedValue({ count: 1 } as never)

    const response = await DELETE(createDeleteRequest(), { params: createParams() })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.mealId).toBe('meal-123')
    expect(data.isFavorite).toBe(false)
  })
})
