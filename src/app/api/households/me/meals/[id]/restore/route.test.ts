import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

// The restore window and ownership rules live in `restoreHouseholdMeal`,
// tested against a database in `deleted-household-meals.db.test.ts`. This
// file mocks the lib seam and asserts what the route owns: the session, the
// household, and the status each answer maps to (HON-1336).

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

vi.mock('@/lib/deleted-household-meals', () => ({
  restoreHouseholdMeal: vi.fn(),
}))

vi.mock('@/lib/household-meals-read', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/household-meals-read')>()),
  getHouseholdMeal: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { restoreHouseholdMeal } from '@/lib/deleted-household-meals'
import { HouseholdMealError } from '@/lib/household-meal-error'
import { getHouseholdMeal } from '@/lib/household-meals-read'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockRestore = vi.mocked(restoreHouseholdMeal)
const mockGet = vi.mocked(getHouseholdMeal)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const mockMembership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: { id: 'household-123', name: 'Test', timezone: 'Europe/Tallinn', locale: 'et' },
} as never

const ROUTE = '/api/households/me/meals/[id]/restore'
const restore = () =>
  POST(new Request('http://localhost/api/households/me/meals/meal-1/restore', { method: 'POST' }), {
    params: Promise.resolve({ id: 'meal-1' }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(mockMembership)
})

describe('POST /api/households/me/meals/[id]/restore', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await restore()

    expect(response.status).toBe(401)
    expect(mockRestore).not.toHaveBeenCalled()
  })

  it('returns 404 when the user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await restore()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No household found' })
    expect(mockRestore).not.toHaveBeenCalled()
  })

  it('restores the recipe and answers 200 with it in the household locale', async () => {
    const meal = { id: 'meal-1', name: 'Kanakarri', deletedAt: null }
    mockGet.mockResolvedValue(meal as never)

    const response = await restore()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(meal)
    expect(mockRestore).toHaveBeenCalledWith('household-123', 'meal-1')
    expect(mockGet).toHaveBeenCalledWith('household-123', 'meal-1', 'et')
  })

  it('returns 404 for a recipe that is not the household’s or is past the restore window', async () => {
    mockRestore.mockRejectedValue(new HouseholdMealError('mealNotFound'))

    const response = await restore()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Recipe not found' })
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('returns 409 for a live recipe', async () => {
    mockRestore.mockRejectedValue(new HouseholdMealError('mealNotDeleted'))

    const response = await restore()

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Recipe is not deleted' })
  })

  it('returns 500 and reports the error when the restore throws', async () => {
    const error = new Error('connection lost')
    mockRestore.mockRejectedValue(error)

    const response = await restore()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to restore recipe' })
    expect(mockCaptureApiError).toHaveBeenCalledWith(error, { route: ROUTE, userId: 'user-123' })
  })
})
