import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'

// The read lives in `@/lib/meal-planning/load-pantry` and the write in
// `@/lib/pantry/pantry-items`, each tested against a database in its
// `*.db.test.ts`. This file mocks both at the seam and asserts what the route
// owns: the session, the household, the query string, body validation, and
// the status and body each outcome maps to (HON-1209).

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

vi.mock('@/lib/meal-planning/load-pantry', () => ({
  loadPantry: vi.fn(),
}))

vi.mock('@/lib/pantry/pantry-items', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pantry/pantry-items')>()),
  createPantryItem: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { loadPantry } from '@/lib/meal-planning/load-pantry'
import { createPantryItem } from '@/lib/pantry/pantry-items'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockLoadPantry = vi.mocked(loadPantry)
const mockCreatePantryItem = vi.mocked(createPantryItem)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const mockHousehold = {
  id: 'household-123',
  name: 'Test Household',
  timezone: 'Europe/Tallinn',
  locale: 'en',
  members: [{ preferences: { portionMultiplier: 1 } }, { preferences: { portionMultiplier: 1 } }],
}

const mockMembership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: mockHousehold,
} as never

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(mockMembership)
})

describe('GET /api/pantry', () => {
  const get = (query = '') => GET(new NextRequest(`http://localhost/api/pantry${query}`))

  const pantry = {
    items: [
      {
        id: 'pantry-1',
        ingredientId: 'ing-1',
        ingredient: {
          id: 'ing-1',
          name: 'Chicken breast',
          category: 'protein',
          defaultUnit: 'g',
          displayUnit: 'g',
        },
        quantity: null,
        isStaple: false,
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        neededQuantity: 700,
        neededDisplayQuantity: '700g',
        windowDays: 7,
        isVague: false,
      },
    ],
    windowDays: 7,
  } as const

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await get()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mockLoadPantry).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await get()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No household found' })
    expect(mockLoadPantry).not.toHaveBeenCalled()
  })

  it("returns the household's pantry as loadPantry builds it", async () => {
    mockLoadPantry.mockResolvedValue(pantry as never)

    const response = await get('?days=7')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ...pantry,
      items: [{ ...pantry.items[0], updatedAt: '2024-01-01T00:00:00.000Z' }],
    })
    expect(mockLoadPantry).toHaveBeenCalledWith(mockHousehold, { days: 7 })
  })

  it.each([
    ['', null],
    ['?days=7', 7],
    ['?days=14', 14],
    ['?days=30', null],
    ['?days=abc', null],
  ])('reads "%s" as a window of %s days', async (query, days) => {
    mockLoadPantry.mockResolvedValue({ items: [], windowDays: days } as never)

    await get(query)

    expect(mockLoadPantry).toHaveBeenCalledWith(mockHousehold, { days })
  })

  it('returns 500 and reports a failed read', async () => {
    mockLoadPantry.mockRejectedValue(new Error('db down'))

    const response = await get()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to fetch pantry items' })
    expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/pantry', () => {
  const post = (body: unknown) =>
    POST(
      new Request('http://localhost/api/pantry', {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    )

  const createdItem = {
    id: 'pantry-new',
    ingredientId: 'ing-456',
    quantity: 500,
    isStaple: true,
    updatedAt: new Date('2024-01-10T00:00:00.000Z'),
    ingredient: {
      id: 'ing-456',
      name: 'Olive oil',
      category: 'fat',
      defaultUnit: 'g',
      measuredByVolume: true,
    },
  }

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await post({ ingredientId: 'ing-456' })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mockCreatePantryItem).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid JSON', async () => {
    const response = await post('not valid json')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid JSON' })
  })

  it.each([
    ['a missing ingredientId', {}, 'ingredientId'],
    ['an empty ingredientId', { ingredientId: '' }, 'ingredientId'],
    ['a negative quantity', { ingredientId: 'ing-456', quantity: -1 }, 'quantity'],
    ['a non-boolean isStaple', { ingredientId: 'ing-456', isStaple: 'yes' }, 'isStaple'],
  ])('returns 400 for %s and creates nothing', async (_label, body, field) => {
    const response = await post(body)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(Object.keys(data.details)).toEqual([field])
    expect(mockCreatePantryItem).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await post({ ingredientId: 'ing-456' })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No household found' })
    expect(mockCreatePantryItem).not.toHaveBeenCalled()
  })

  // HON-889: another household's ingredient reads exactly like an unknown one.
  it('returns 404 when the ingredient is not one the household can use', async () => {
    mockCreatePantryItem.mockResolvedValue({ status: 'ingredient_not_found' })

    const response = await post({ ingredientId: 'ing-other-household' })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Ingredient not found' })
  })

  it('returns 409 with the existing id when the ingredient is already in the pantry', async () => {
    mockCreatePantryItem.mockResolvedValue({
      status: 'exists',
      existingId: 'existing-item',
      isStaple: false,
    })

    const response = await post({ ingredientId: 'ing-456' })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Ingredient already in pantry',
      existingId: 'existing-item',
    })
  })

  it('creates the item and returns it with 201', async () => {
    mockCreatePantryItem.mockResolvedValue({ status: 'created', item: createdItem })

    const response = await post({ ingredientId: 'ing-456', quantity: 500, isStaple: true })

    expect(response.status).toBe(201)
    // `measuredByVolume` is the MCP tool's; the route does not return it.
    expect(await response.json()).toEqual({
      id: 'pantry-new',
      ingredientId: 'ing-456',
      ingredient: { id: 'ing-456', name: 'Olive oil', category: 'fat', defaultUnit: 'g' },
      quantity: 500,
      isStaple: true,
      updatedAt: '2024-01-10T00:00:00.000Z',
    })
    expect(mockCreatePantryItem).toHaveBeenCalledWith(mockHousehold, {
      ingredientId: 'ing-456',
      quantity: 500,
      isStaple: true,
    })
  })

  it.each([
    ['no quantity and no isStaple', { ingredientId: 'ing-456' }],
    ['an explicit null quantity', { ingredientId: 'ing-456', quantity: null }],
  ])('creates with a null quantity and isStaple false for %s', async (_label, body) => {
    mockCreatePantryItem.mockResolvedValue({ status: 'created', item: createdItem })

    await post(body)

    expect(mockCreatePantryItem).toHaveBeenCalledWith(mockHousehold, {
      ingredientId: 'ing-456',
      quantity: null,
      isStaple: false,
    })
  })

  it('returns 500 and reports an unexpected error', async () => {
    mockCreatePantryItem.mockRejectedValue(new Error('db down'))

    const response = await post({ ingredientId: 'ing-456' })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to add pantry item' })
    expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
  })
})
