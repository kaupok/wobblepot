import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DELETE, PATCH } from './route'

// Every query lives in `@/lib/pantry/pantry-items`, tested against a database
// in `pantry-items.db.test.ts`. This file mocks that module at the seam and
// asserts what the route owns: the session, the household, body validation,
// and the status and body each outcome maps to (HON-1209).

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
  updatePantryItem: vi.fn(),
  deletePantryItem: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { deletePantryItem, updatePantryItem } from '@/lib/pantry/pantry-items'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockUpdatePantryItem = vi.mocked(updatePantryItem)
const mockDeletePantryItem = vi.mocked(deletePantryItem)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const mockHousehold = { id: 'household-123', name: 'Test', locale: 'en', timezone: 'UTC' }

const mockMembership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: mockHousehold,
} as never

const savedItem = {
  id: 'pantry-123',
  ingredientId: 'ing-456',
  quantity: 250,
  isStaple: false,
  lowAt: null,
  updatedAt: new Date('2024-01-10T00:00:00.000Z'),
  ingredient: {
    id: 'ing-456',
    name: 'Olive oil',
    category: 'fat',
    defaultUnit: 'g',
    measuredByVolume: true,
  },
}

const URL = 'http://localhost/api/pantry/pantry-123'
const params = () => Promise.resolve({ id: 'pantry-123' })

const patch = (body: unknown) =>
  PATCH(
    new Request(URL, {
      method: 'PATCH',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: params() },
  )
const del = () => DELETE(new Request(URL, { method: 'DELETE' }), { params: params() })

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(mockMembership)
})

describe('PATCH /api/pantry/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await patch({ quantity: 250 })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mockUpdatePantryItem).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid JSON', async () => {
    const response = await patch('not valid json')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid JSON' })
    expect(mockCaptureApiError).not.toHaveBeenCalled()
  })

  it.each([
    ['a quantity that is not a number', { quantity: 'not a number' }],
    ['a negative quantity', { quantity: -1 }],
    ['a non-boolean isStaple', { isStaple: 'yes' }],
    // An empty update still bumps `@updatedAt`, which the shopping-list routes
    // read as "purchased", so a body with nothing to write must 400 (HON-642).
    ['an empty body', {}],
    ['a body with only an unknown key (stripped to {})', { quantitiy: 5 }],
  ])('returns 400 for %s and writes nothing', async (_label, body) => {
    const response = await patch(body)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(mockUpdatePantryItem).not.toHaveBeenCalled()
  })

  it('names the field a negative quantity fails on', async () => {
    const response = await patch({ quantity: -1 })
    const data = await response.json()

    expect(Object.keys(data.details)).toEqual(['quantity'])
  })

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await patch({ quantity: 250 })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No household found' })
    expect(mockUpdatePantryItem).not.toHaveBeenCalled()
  })

  it("returns 404 when the household's pantry has no such item", async () => {
    mockUpdatePantryItem.mockResolvedValue({ status: 'not_found' })

    const response = await patch({ quantity: 250 })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Pantry item not found' })
  })

  it("updates the item in the caller's household and returns it", async () => {
    mockUpdatePantryItem.mockResolvedValue({ status: 'updated', item: savedItem })

    const response = await patch({ quantity: 250 })

    expect(response.status).toBe(200)
    // `measuredByVolume` is the MCP tool's; the route does not return it.
    expect(await response.json()).toEqual({
      id: 'pantry-123',
      ingredient: { id: 'ing-456', name: 'Olive oil', category: 'fat', defaultUnit: 'g' },
      quantity: 250,
      isStaple: false,
      low: false,
      updatedAt: '2024-01-10T00:00:00.000Z',
    })
    expect(mockUpdatePantryItem).toHaveBeenCalledWith(mockHousehold, 'pantry-123', {
      quantity: 250,
    })
  })

  // Presence is `!== undefined`, not truthiness: each of these is a real update
  // and must reach the lib as given.
  it.each([
    ['a quantity of 0, "none left, still tracked"', { quantity: 0 }],
    ['a null quantity, "have some"', { quantity: null }],
    ['isStaple false', { isStaple: false }],
    ['both fields', { quantity: 0, isStaple: true }],
    ['low true, "running low" (HON-1586)', { low: true }],
    ['low false', { low: false }],
  ])('passes %s to the update', async (_label, body) => {
    mockUpdatePantryItem.mockResolvedValue({ status: 'updated', item: savedItem })

    const response = await patch(body)

    expect(response.status).toBe(200)
    expect(mockUpdatePantryItem).toHaveBeenCalledWith(mockHousehold, 'pantry-123', body)
  })

  it('returns low true for a row marked running low (HON-1586)', async () => {
    mockUpdatePantryItem.mockResolvedValue({
      status: 'updated',
      item: { ...savedItem, quantity: null, lowAt: new Date('2026-11-01T18:00:00.000Z') },
    })

    const response = await patch({ low: true })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ quantity: null, low: true })
  })

  it('returns 500 with the { error } JSON shape and reports an unexpected error', async () => {
    mockUpdatePantryItem.mockRejectedValue(new Error('db down'))

    const response = await patch({ isStaple: true })

    expect(response.status).toBe(500)
    // `apiFetch` parses the body and surfaces `error`; a bare Next.js 500
    // would not be JSON at all.
    expect(await response.json()).toEqual({ error: 'Failed to update pantry item' })
    expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
  })
})

describe('DELETE /api/pantry/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await del()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mockDeletePantryItem).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    const response = await del()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No household found' })
    expect(mockDeletePantryItem).not.toHaveBeenCalled()
  })

  it("returns 404 when the household's pantry has no such item", async () => {
    mockDeletePantryItem.mockResolvedValue({ status: 'not_found' })

    const response = await del()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Pantry item not found' })
  })

  it("deletes the item from the caller's household and returns 204", async () => {
    mockDeletePantryItem.mockResolvedValue({ status: 'deleted' })

    const response = await del()

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(mockDeletePantryItem).toHaveBeenCalledWith('household-123', 'pantry-123')
  })

  it('returns 500 with the { error } JSON shape and reports an unexpected error', async () => {
    mockDeletePantryItem.mockRejectedValue(new Error('db down'))

    const response = await del()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to delete pantry item' })
    expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
  })
})
