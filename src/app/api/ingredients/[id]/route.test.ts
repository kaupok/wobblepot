import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PATCH, DELETE } from './route'

// The queries live in `@/lib/ingredients/manage`, tested against a database in
// `manage.db.test.ts`. This file mocks that module at the seam and asserts what
// the route owns: the session, the household, the body, the rate limit, and
// the status and body of each result (HON-1264).

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

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  retryAfterSeconds: vi.fn(() => 90),
}))

vi.mock('@/lib/ingredients/manage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ingredients/manage')>()),
  updateHouseholdIngredient: vi.fn(),
  deleteHouseholdIngredient: vi.fn(),
}))

import { auth } from '@/lib/auth'
import type { HouseholdIngredient } from '@/lib/ingredients/household-ingredient'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { checkRateLimit } from '@/lib/rate-limit'
import { deleteHouseholdIngredient, updateHouseholdIngredient } from '@/lib/ingredients/manage'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockRateLimit = vi.mocked(checkRateLimit)
const mockUpdate = vi.mocked(updateHouseholdIngredient)
const mockDelete = vi.mocked(deleteHouseholdIngredient)

const allowed = { allowed: true, limit: 30, remaining: 29, resetAt: new Date(0) }
const params = { params: Promise.resolve({ id: 'ing-lovage' }) }

const lovage = {
  name: 'Lovage',
  category: 'vegetable',
  defaultUnit: 'g',
  allergens: [],
  calories: 36,
  protein: 3,
  carbs: 6,
  fat: 0.5,
}
const saved = {
  id: 'ing-lovage',
  name: 'lovage',
  category: 'vegetable',
  proteinType: null,
  defaultUnit: 'g',
  gramsPerPiece: null,
  allergens: [],
  calories: 36,
  protein: 3,
  carbs: 6,
  fat: 0.5,
  fiber: null,
} satisfies HouseholdIngredient
const uses = { meals: 2, pantry: 0, shoppingList: 1, mealPlan: 0, extras: 0 }

const patch = (body: unknown) =>
  PATCH(
    new Request('http://localhost/api/ingredients/ing-lovage', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    params,
  )
const del = () =>
  DELETE(new Request('http://localhost/api/ingredients/ing-lovage', { method: 'DELETE' }), params)

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue({ user: { id: 'user-123' }, session: {} } as never)
  mockGetMembership.mockResolvedValue({
    householdId: 'household-123',
    household: { id: 'household-123', locale: 'et' },
  } as never)
  mockRateLimit.mockResolvedValue(allowed as never)
})

describe('PATCH /api/ingredients/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect((await patch(lovage)).status).toBe(401)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 403 for a user with no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect((await patch(lovage)).status).toBe(403)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 with the field names on a body POST would refuse', async () => {
    const response = await patch({ ...lovage, defaultUnit: 'piece' })

    expect(response.status).toBe(400)
    expect(Object.keys((await response.json()).details)).toEqual(['gramsPerPiece'])
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 429 with Retry-After past the ingredient-create limit', async () => {
    mockRateLimit.mockResolvedValue({ ...allowed, allowed: false, remaining: 0 } as never)

    const response = await patch(lovage)

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('90')
    expect(mockRateLimit).toHaveBeenCalledWith('household-123', 'ingredient-create')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("returns 200 with the saved row, edited in the household's locale", async () => {
    mockUpdate.mockResolvedValue({ status: 'updated', ingredient: saved })

    const response = await patch(lovage)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ingredient: saved })
    expect(mockUpdate).toHaveBeenCalledWith('household-123', 'et', 'ing-lovage', lovage)
  })

  it("returns 404 for a global row or another household's row", async () => {
    mockUpdate.mockResolvedValue({ status: 'not_found' })

    expect((await patch(lovage)).status).toBe(404)
  })

  it('returns 409 name_taken for a name the catalogue has', async () => {
    mockUpdate.mockResolvedValue({ status: 'name_taken' })

    const response = await patch(lovage)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'name_taken' })
  })

  it('returns 409 unit_locked with the uses for a unit change on a used row', async () => {
    mockUpdate.mockResolvedValue({ status: 'unit_locked', uses })

    const response = await patch(lovage)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'unit_locked', uses })
  })

  it('returns 500 and reports a failed save', async () => {
    mockUpdate.mockRejectedValue(new Error('db down'))

    expect((await patch(lovage)).status).toBe(500)
    expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
  })
})

describe('DELETE /api/ingredients/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect((await del()).status).toBe(401)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('returns 403 for a user with no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect((await del()).status).toBe(403)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('returns 429 past the ingredient-create limit', async () => {
    mockRateLimit.mockResolvedValue({ ...allowed, allowed: false, remaining: 0 } as never)

    expect((await del()).status).toBe(429)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("returns 204 once the household's row is deleted", async () => {
    mockDelete.mockResolvedValue({ status: 'deleted' })

    const response = await del()

    expect(response.status).toBe(204)
    expect(mockDelete).toHaveBeenCalledWith('household-123', 'ing-lovage')
  })

  it("returns 404 for a global row or another household's row", async () => {
    mockDelete.mockResolvedValue({ status: 'not_found' })

    expect((await del()).status).toBe(404)
  })

  it('returns 409 in_use with the uses', async () => {
    mockDelete.mockResolvedValue({ status: 'in_use', uses })

    const response = await del()

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'in_use', uses })
  })

  it('returns 500 and reports a failed delete', async () => {
    mockDelete.mockRejectedValue(new Error('db down'))

    expect((await del()).status).toBe(500)
    expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
  })
})
