import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PATCH, DELETE } from './route'

// The read, update and delete queries, and the rules for when an edit clears
// the cached tips and the image, live in `@/lib/household-meals`, tested
// against a database in `household-meals.db.test.ts`. This file mocks that
// module at the seam and asserts what the route owns: the session, the
// household, body validation, the blob delete after an edit commits, and the status
// and body each answer maps to (HON-1210).

// `after()` callbacks are collected and run by the test, so a case can assert
// on the response before any of the work has happened, as in production.
const afterCallbacks: Array<() => unknown> = []
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn((callback: () => unknown) => {
    afterCallbacks.push(callback)
  }),
}))

// The image claim and draw live in `@/lib/meal-images/start`, tested in
// `start.test.ts`; the route owns when they run (HON-1364).
vi.mock('@/lib/meal-images/start', () => ({
  claimSavedMealImage: vi.fn(),
  drawSavedMealImage: vi.fn(),
}))

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

vi.mock('@/lib/meal-images/storage', () => ({
  discardMealImage: vi.fn(),
}))

vi.mock('@/lib/household-meals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/household-meals')>()),
  getHouseholdMeal: vi.fn(),
  updateHouseholdMeal: vi.fn(),
  deleteHouseholdMeal: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { claimSavedMealImage, drawSavedMealImage } from '@/lib/meal-images/start'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { discardMealImage } from '@/lib/meal-images/storage'
import {
  deleteHouseholdMeal,
  getHouseholdMeal,
  HouseholdMealError,
  updateHouseholdMeal,
} from '@/lib/household-meals'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockClaimImage = vi.mocked(claimSavedMealImage)
const mockDrawImage = vi.mocked(drawSavedMealImage)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockDiscardMealImage = vi.mocked(discardMealImage)
const mockGet = vi.mocked(getHouseholdMeal)
const mockUpdate = vi.mocked(updateHouseholdMeal)
const mockDelete = vi.mocked(deleteHouseholdMeal)

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

const ROUTE = '/api/households/me/meals/[id]'
const URL = 'http://localhost/api/households/me/meals/meal-1'
const params = { params: Promise.resolve({ id: 'meal-1' }) }
const storedImageUrl = 'https://store123.public.blob.vercel-storage.com/meals/meal-1-AbC123.png'

function patch(body: unknown) {
  return PATCH(
    new Request(URL, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    params,
  )
}

const remove = () => DELETE(new Request(URL, { method: 'DELETE' }), params)

beforeEach(() => {
  vi.clearAllMocks()
  afterCallbacks.length = 0
  mockClaimImage.mockResolvedValue(null)
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(mockMembership)
})

describe('GET /api/households/me/meals/[id]', () => {
  const get = () => GET(new NextRequest(URL), params)

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await get()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 404 when the user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await get()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No household found' })
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('returns the meal in the household locale', async () => {
    const meal = { id: 'meal-1', name: 'Kanakarri', isCustom: true }
    mockGet.mockResolvedValue(meal as never)

    const response = await get()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(meal)
    expect(mockGet).toHaveBeenCalledWith('household-123', 'meal-1', 'et')
  })

  it('returns 404 when the meal is not the household’s', async () => {
    mockGet.mockRejectedValue(new HouseholdMealError('mealNotFound'))

    const response = await get()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Meal not found' })
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('returns 500 and reports the error when the lib throws', async () => {
    const error = new Error('connection lost')
    mockGet.mockRejectedValue(error)

    const response = await get()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to fetch meal' })
    expect(mockCaptureApiError).toHaveBeenCalledWith(error, { route: ROUTE, userId: 'user-123' })
  })
})

describe('PATCH /api/households/me/meals/[id]', () => {
  const updated = { id: 'meal-1', name: 'Updated meal', isCustom: true }

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await patch({ name: 'Updated meal' })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 400 for invalid JSON', async () => {
    const response = await patch('not json')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid JSON' })
  })

  it('returns 400 with the field errors for an invalid body', async () => {
    const response = await patch({ name: '', servings: 0 })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Validation failed')
    expect(Object.keys(data.details).sort()).toEqual(['name', 'servings'])
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects a javascript: sourceUrl', async () => {
    const response = await patch({ sourceUrl: 'javascript:alert(1)' })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.details.sourceUrl).toEqual(['Only http/https URLs are allowed'])
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('names the repeated ingredient when a component id appears twice', async () => {
    const response = await patch({
      components: [
        { ingredientId: 'ing-1', totalQuantity: 100 },
        { ingredientId: 'ing-1', totalQuantity: 200 },
      ],
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Duplicate ingredients in components',
      duplicateIds: ['ing-1'],
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects more than 50 components', async () => {
    const response = await patch({
      components: Array.from({ length: 51 }, (_, i) => ({
        ingredientId: `ing-${i}`,
        totalQuantity: 10,
      })),
    })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Validation failed')
    expect(data.details.components).toHaveLength(1)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 404 when the user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await patch({ name: 'Updated meal' })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No household found' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('passes only the keys sent, with the schema defaults applied to components', async () => {
    mockUpdate.mockResolvedValue({ meal: updated, discardedImageUrl: null } as never)

    await patch({
      description: null,
      servings: 6,
      components: [{ ingredientId: 'ing-1', totalQuantity: 0, isVague: true }],
    })

    expect(mockUpdate).toHaveBeenCalledWith('household-123', 'meal-1', {
      description: null,
      servings: 6,
      components: [{ ingredientId: 'ing-1', totalQuantity: 0, isVague: true }],
    })
  })

  it('returns the updated meal and deletes no blob when the image was kept', async () => {
    mockUpdate.mockResolvedValue({ meal: updated, discardedImageUrl: null } as never)

    const response = await patch({ name: 'Updated meal' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(updated)
    expect(mockDiscardMealImage).toHaveBeenCalledWith(null, ROUTE)
  })

  it('deletes the cleared image’s blob once the update has returned', async () => {
    mockUpdate.mockResolvedValue({ meal: updated, discardedImageUrl: storedImageUrl } as never)

    const response = await patch({ name: 'Updated meal' })

    expect(response.status).toBe(200)
    expect(mockDiscardMealImage).toHaveBeenCalledWith(storedImageUrl, ROUTE)
  })

  describe('the image (HON-1364)', () => {
    const imageClaim = { meal: { id: 'meal-1' }, claim: { mealId: 'meal-1' } } as never

    it('starts a new image after the response when the edit cleared it', async () => {
      mockUpdate.mockResolvedValue({
        meal: updated,
        discardedImageUrl: null,
        imageInvalidated: true,
      } as never)
      mockClaimImage.mockResolvedValue(imageClaim)

      const response = await patch({ name: 'Updated meal' })

      expect(response.status).toBe(200)
      expect(mockClaimImage).toHaveBeenCalledExactlyOnceWith('household-123', 'meal-1', ROUTE)
      expect(mockDrawImage).not.toHaveBeenCalled()

      await afterCallbacks[0]!()

      expect(mockDrawImage).toHaveBeenCalledExactlyOnceWith(imageClaim, {
        householdId: 'household-123',
        userId: 'user-123',
        route: ROUTE,
      })
    })

    it('starts nothing when the edit kept the image', async () => {
      mockUpdate.mockResolvedValue({
        meal: updated,
        discardedImageUrl: null,
        imageInvalidated: false,
      } as never)

      await patch({ servings: 6 })

      expect(mockClaimImage).not.toHaveBeenCalled()
      expect(afterCallbacks).toHaveLength(0)
    })
  })

  it('returns 404 when the recipe is not the household’s or is deleted', async () => {
    mockUpdate.mockRejectedValue(new HouseholdMealError('mealNotFound'))

    const response = await patch({ name: 'Updated meal' })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Recipe not found' })
    expect(mockDiscardMealImage).not.toHaveBeenCalled()
  })

  it('returns 400 with the missing ids when an ingredient is not found', async () => {
    mockUpdate.mockRejectedValue(new HouseholdMealError('ingredientsNotFound', ['ing-other']))

    const response = await patch({
      components: [{ ingredientId: 'ing-other', totalQuantity: 100 }],
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Some ingredients not found',
      missingIds: ['ing-other'],
    })
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('returns 500 with the { error } JSON shape and deletes no blob when the update throws', async () => {
    const error = new Error('transaction rolled back')
    mockUpdate.mockRejectedValue(error)

    const response = await patch({ name: 'Updated meal' })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to update recipe' })
    expect(mockDiscardMealImage).not.toHaveBeenCalled()
    expect(mockCaptureApiError).toHaveBeenCalledWith(error, { route: ROUTE, userId: 'user-123' })
  })
})

describe('DELETE /api/households/me/meals/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await remove()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 404 when the user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await remove()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No household found' })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('returns 404 when the meal is not the household’s or is already deleted', async () => {
    mockDelete.mockRejectedValue(new HouseholdMealError('mealNotFound'))

    const response = await remove()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Meal not found' })
    expect(mockDiscardMealImage).not.toHaveBeenCalled()
  })

  it('deletes the meal and keeps its image blob, so a restore brings it back (HON-1336)', async () => {
    mockDelete.mockResolvedValue({ id: 'meal-1', name: 'Curry', deletedAt: new Date() })

    const response = await remove()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockDelete).toHaveBeenCalledWith('household-123', 'meal-1')
    expect(mockDiscardMealImage).not.toHaveBeenCalled()
  })

  it('returns 500 with the { error } JSON shape when the delete throws', async () => {
    const error = new Error('connection lost')
    mockDelete.mockRejectedValue(error)

    const response = await remove()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to delete meal' })
    expect(mockDiscardMealImage).not.toHaveBeenCalled()
    expect(mockCaptureApiError).toHaveBeenCalledWith(error, { route: ROUTE, userId: 'user-123' })
  })
})
