import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DELETE, PATCH } from './route'

// The delete lives in `@/lib/pantry/pantry-items`, tested against a database in
// `pantry-items.db.test.ts`. This file mocks that module at the seam and
// asserts what the route owns: the session, the household, and the status and
// body each outcome maps to (HON-1209).

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

vi.mock('@/lib/pantry/pantry-items', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pantry/pantry-items')>()),
  deletePantryItemByIngredient: vi.fn(),
  updatePantryItemByIngredient: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import {
  deletePantryItemByIngredient,
  updatePantryItemByIngredient,
} from '@/lib/pantry/pantry-items'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockDelete = vi.mocked(deletePantryItemByIngredient)
const mockUpdate = vi.mocked(updatePantryItemByIngredient)

const mockSession = {
  user: { id: 'user-1', name: 'Test', email: 'test@example.com' },
  session: { id: 'session-1' },
} as never

const mockMembership = {
  id: 'member-1',
  householdId: 'household-1',
  userId: 'user-1',
  role: 'owner',
  household: { id: 'household-1', name: 'Test', locale: 'en' },
} as never

const del = () =>
  DELETE(new Request('http://localhost/api/pantry/by-ingredient/ing-1', { method: 'DELETE' }), {
    params: Promise.resolve({ ingredientId: 'ing-1' }),
  })

const patch = (body: unknown) =>
  PATCH(
    new Request('http://localhost/api/pantry/by-ingredient/ing-1', {
      method: 'PATCH',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ ingredientId: 'ing-1' }) },
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(mockMembership)
})

describe('DELETE /api/pantry/by-ingredient/[ingredientId]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await del()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await del()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No household found' })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("returns 404 when the caller's pantry does not hold the ingredient", async () => {
    mockDelete.mockResolvedValue({ status: 'not_found' })

    const response = await del()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Pantry item not found' })
  })

  it("removes the ingredient from the caller's pantry and returns 204", async () => {
    mockDelete.mockResolvedValue({ status: 'deleted' })

    const response = await del()

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(mockDelete).toHaveBeenCalledWith('household-1', 'ing-1')
  })

  it('returns 500 and reports an unexpected error', async () => {
    mockDelete.mockRejectedValue(new Error('DB down'))

    const response = await del()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to delete pantry item' })
    expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
  })
})

describe('PATCH /api/pantry/by-ingredient/[ingredientId] (HON-1599)', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await patch({ quantity: 0 })

    expect(response.status).toBe(401)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 on a body that is not JSON', async () => {
    const response = await patch('not json')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid JSON' })
  })

  it.each([[{ quantity: 5 }], [{}], [{ isStaple: false }]])(
    'returns 400 on %j, because only ran out and have some are allowed',
    async (body) => {
      const response = await patch(body)

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'Validation failed' })
      expect(mockUpdate).not.toHaveBeenCalled()
    },
  )

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await patch({ quantity: 0 })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No household found' })
  })

  it("returns 404 when the caller's pantry does not hold the ingredient", async () => {
    mockUpdate.mockResolvedValue({ status: 'not_found' })

    const response = await patch({ quantity: 0 })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Pantry item not found' })
  })

  it.each([[0], [null]])('sets the quantity to %s and returns the item', async (quantity) => {
    mockUpdate.mockResolvedValue({
      status: 'updated',
      item: { id: 'item-1', quantity, isStaple: true } as never,
    })

    const response = await patch({ quantity })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 'item-1', quantity, isStaple: true })
    expect(mockUpdate).toHaveBeenCalledWith(
      { id: 'household-1', name: 'Test', locale: 'en' },
      'ing-1',
      { quantity },
    )
  })

  it('returns 500 and reports an unexpected error', async () => {
    mockUpdate.mockRejectedValue(new Error('DB down'))

    const response = await patch({ quantity: 0 })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to update pantry item' })
    expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
  })
})
