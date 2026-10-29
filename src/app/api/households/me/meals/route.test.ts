import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GET, POST } from './route'

// The list and create queries live in `@/lib/household-meals`, tested against
// a database in `household-meals.db.test.ts`. This file mocks that module at
// the seam and asserts what the route owns: the session, the household, query
// and body validation, and the status and body each answer maps to (HON-1210).

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

vi.mock('@/lib/household-meals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/household-meals')>()),
  createHouseholdMeal: vi.fn(),
}))

vi.mock('@/lib/household-meals-read', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/household-meals-read')>()),
  listHouseholdMeals: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { createHouseholdMeal, HouseholdMealError } from '@/lib/household-meals'
import { listHouseholdMeals } from '@/lib/household-meals-read'
import { claimSavedMealImage, drawSavedMealImage } from '@/lib/meal-images/start'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockClaimImage = vi.mocked(claimSavedMealImage)
const mockDrawImage = vi.mocked(drawSavedMealImage)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockList = vi.mocked(listHouseholdMeals)
const mockCreate = vi.mocked(createHouseholdMeal)

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

const URL = 'http://localhost/api/households/me/meals'

function get(query = '') {
  return GET(new NextRequest(`${URL}${query}`))
}

function post(body: unknown) {
  return POST(
    new Request(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

const validBody = {
  name: 'New meal',
  suitableFor: ['dinner'],
  servings: 2,
  components: [
    { ingredientId: 'ing-1', totalQuantity: 300 },
    { ingredientId: 'ing-2', totalQuantity: 0, isVague: true, originalPhrase: 'a pinch' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  afterCallbacks.length = 0
  mockClaimImage.mockResolvedValue(null)
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(mockMembership)
})

describe('GET /api/households/me/meals', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await get()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mockList).not.toHaveBeenCalled()
  })

  it('returns 404 when the user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await get()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No household found' })
  })

  it("returns the lib's page as it is", async () => {
    const page = { meals: [{ id: 'meal-1', name: 'Chicken rice bowl' }], nextCursor: 'meal-1' }
    mockList.mockResolvedValue(page as never)

    const response = await get()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(page)
  })

  it('asks for the first page of 30 live meals in the household locale by default', async () => {
    mockList.mockResolvedValue({ meals: [], nextCursor: null })
    // 22:30 UTC on 1 March is already 2 March in Tallinn (UTC+2).
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-03-01T22:30:00Z') })

    try {
      await get()
    } finally {
      vi.useRealTimers()
    }

    expect(mockList).toHaveBeenCalledWith({
      householdId: 'household-123',
      locale: 'et',
      today: '2026-03-02',
      search: null,
      cursor: null,
      limit: 30,
      includeDeleted: false,
    })
  })

  it('passes the trimmed search, the cursor, the limit and includeDeleted', async () => {
    mockList.mockResolvedValue({ meals: [], nextCursor: null })

    await get('?search=%20curry%20&cursor=meal-9&limit=10&includeDeleted=true')

    expect(mockList).toHaveBeenCalledWith({
      householdId: 'household-123',
      locale: 'et',
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      search: 'curry',
      cursor: 'meal-9',
      limit: 10,
      includeDeleted: true,
    })
  })

  it.each(['abc', '101', '0'])('returns 400 for limit=%s', async (limit) => {
    const response = await get(`?limit=${limit}`)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid limit parameter' })
    expect(mockList).not.toHaveBeenCalled()
  })

  it('returns 500 and reports the error when the lib throws', async () => {
    const error = new Error('connection lost')
    mockList.mockRejectedValue(error)

    const response = await get()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to fetch meals' })
    expect(mockCaptureApiError).toHaveBeenCalledWith(error, {
      route: '/api/households/me/meals',
      userId: 'user-123',
    })
  })
})

describe('POST /api/households/me/meals', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await post(validBody)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 400 for invalid JSON', async () => {
    const response = await post('not json')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid JSON' })
  })

  it('rejects a javascript: sourceUrl', async () => {
    const response = await post({ ...validBody, sourceUrl: 'javascript:alert(1)' })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Validation failed')
    expect(data.details.sourceUrl).toEqual(['Only http/https URLs are allowed'])
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 400 with the field errors for an invalid body', async () => {
    const response = await post({ name: '' })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Validation failed')
    expect(Object.keys(data.details).sort()).toEqual([
      'components',
      'name',
      'servings',
      'suitableFor',
    ])
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('names the repeated ingredient when a component id appears twice', async () => {
    const response = await post({
      ...validBody,
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
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('rejects more than 50 components', async () => {
    const response = await post({
      ...validBody,
      components: Array.from({ length: 51 }, (_, i) => ({
        ingredientId: `ing-${i}`,
        totalQuantity: 10,
      })),
    })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Validation failed')
    expect(data.details.components).toHaveLength(1)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 404 when the user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await post(validBody)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No household found' })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('creates the meal from the validated body and returns 201 with it', async () => {
    const created = { id: 'meal-new', name: 'New meal', isCustom: true }
    mockCreate.mockResolvedValue(created as never)

    const response = await post({ ...validBody, sourceUrl: 'https://example.com/recipe' })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(created)
    expect(mockCreate).toHaveBeenCalledWith('household-123', {
      name: 'New meal',
      sourceUrl: 'https://example.com/recipe',
      kidFriendly: false,
      suitableFor: ['dinner'],
      servings: 2,
      components: [
        { ingredientId: 'ing-1', totalQuantity: 300, isVague: false },
        { ingredientId: 'ing-2', totalQuantity: 0, isVague: true, originalPhrase: 'a pinch' },
      ],
    })
  })

  describe('the image (HON-1364)', () => {
    const imageClaim = { meal: { id: 'meal-new' }, claim: { mealId: 'meal-new' } } as never

    it('claims the new recipe’s image and draws it only after the response', async () => {
      mockCreate.mockResolvedValue({ id: 'meal-new', name: 'New meal' } as never)
      mockClaimImage.mockResolvedValue(imageClaim)

      const response = await post(validBody)

      expect(response.status).toBe(201)
      expect(mockClaimImage).toHaveBeenCalledExactlyOnceWith(
        'household-123',
        'meal-new',
        '/api/households/me/meals',
      )
      expect(afterCallbacks).toHaveLength(1)
      expect(mockDrawImage).not.toHaveBeenCalled()

      await afterCallbacks[0]!()

      expect(mockDrawImage).toHaveBeenCalledExactlyOnceWith(imageClaim, {
        householdId: 'household-123',
        userId: 'user-123',
        route: '/api/households/me/meals',
      })
    })

    it('schedules no draw when the claim is not won', async () => {
      mockCreate.mockResolvedValue({ id: 'meal-new', name: 'New meal' } as never)

      const response = await post(validBody)

      expect(response.status).toBe(201)
      expect(afterCallbacks).toHaveLength(0)
    })

    it('claims nothing when the recipe was not created', async () => {
      mockCreate.mockRejectedValue(new HouseholdMealError('ingredientsNotFound', ['ing-2']))

      await post(validBody)

      expect(mockClaimImage).not.toHaveBeenCalled()
      expect(afterCallbacks).toHaveLength(0)
    })
  })

  it('returns 400 with the missing ids when an ingredient is not found', async () => {
    mockCreate.mockRejectedValue(
      new HouseholdMealError('ingredientsNotFound', ['ing-2', 'ing-other-household']),
    )

    const response = await post(validBody)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Some ingredients not found',
      missingIds: ['ing-2', 'ing-other-household'],
    })
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('passes a chosen main protein to the lib', async () => {
    mockCreate.mockResolvedValue({ id: 'meal-new' } as never)

    await post({ ...validBody, proteinTypeOverride: 'beef' })

    expect(mockCreate).toHaveBeenCalledWith(
      'household-123',
      expect.objectContaining({ proteinTypeOverride: 'beef' }),
    )
  })

  it('rejects none as a chosen main protein', async () => {
    const response = await post({ ...validBody, proteinTypeOverride: 'none' })

    expect(response.status).toBe(400)
    expect((await response.json()).details.proteinTypeOverride).toHaveLength(1)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 400 with a code when no ingredient carries the chosen protein', async () => {
    mockCreate.mockRejectedValue(new HouseholdMealError('proteinTypeNotInRecipe'))

    const response = await post({ ...validBody, proteinTypeOverride: 'fish' })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'No ingredient carries that protein',
      code: 'proteinTypeNotInRecipe',
    })
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it('returns 500 and reports the error when the lib throws', async () => {
    const error = new Error('connection lost')
    mockCreate.mockRejectedValue(error)

    const response = await post(validBody)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to create recipe' })
    expect(mockCaptureApiError).toHaveBeenCalledWith(error, {
      route: '/api/households/me/meals',
      userId: 'user-123',
    })
  })
})
