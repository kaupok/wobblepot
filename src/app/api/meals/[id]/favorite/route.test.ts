import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DELETE, POST } from './route'

// Every query lives in `@/lib/meals/favorite`, tested against a database in
// `favorite.db.test.ts`. This file mocks that module at the seam and asserts
// what the route owns: the session, the household, and the status and body
// each answer maps to (HON-1211).

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

vi.mock('@/lib/meals/favorite', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meals/favorite')>()),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { addFavorite, FavoriteError, removeFavorite } from '@/lib/meals/favorite'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockAddFavorite = vi.mocked(addFavorite)
const mockRemoveFavorite = vi.mocked(removeFavorite)

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

const params = () => Promise.resolve({ id: 'meal-123' })
const URL = 'http://localhost/api/meals/meal-123/favorite'

const post = () => POST(new Request(URL, { method: 'POST' }), { params: params() })
const del = () => DELETE(new Request(URL, { method: 'DELETE' }), { params: params() })

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(mockMembership)
})

describe('POST /api/meals/[id]/favorite', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await post()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mockAddFavorite).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await post()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No household found' })
  })

  it("favourites the meal for the caller's household and returns 201", async () => {
    mockAddFavorite.mockResolvedValue({ id: 'fav-new' })

    const response = await post()

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ id: 'fav-new', mealId: 'meal-123', isFavorite: true })
    expect(mockAddFavorite).toHaveBeenCalledWith('household-123', 'meal-123')
  })

  it.each([
    ['mealNotFound', 404, 'Meal not found'],
    ['alreadyFavorite', 409, 'Meal is already favorited'],
  ] as const)('maps %s to %i', async (reason, status, error) => {
    mockAddFavorite.mockRejectedValue(new FavoriteError(reason))

    const response = await post()

    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error })
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('returns 500 and reports an unexpected error', async () => {
    mockAddFavorite.mockRejectedValue(new Error('db down'))

    const response = await post()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to favorite meal' })
    expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
  })
})

describe('DELETE /api/meals/[id]/favorite', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await del()

    expect(response.status).toBe(401)
    expect(mockRemoveFavorite).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await del()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No household found' })
  })

  it("removes the favourite for the caller's household and returns 200", async () => {
    mockRemoveFavorite.mockResolvedValue(undefined)

    const response = await del()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ mealId: 'meal-123', isFavorite: false })
    expect(mockRemoveFavorite).toHaveBeenCalledWith('household-123', 'meal-123')
  })

  it('returns 404 when the meal is not a favourite', async () => {
    mockRemoveFavorite.mockRejectedValue(new FavoriteError('notFavorite'))

    const response = await del()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Favorite not found' })
  })

  it('returns 500 and reports an unexpected error', async () => {
    mockRemoveFavorite.mockRejectedValue(new Error('db down'))

    const response = await del()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to unfavorite meal' })
    expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
  })
})
