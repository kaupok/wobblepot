import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PATCH, DELETE } from './route'

// The ownership checks, the writes and the pantry upsert live in
// `@/lib/shopping/custom-items`, tested against a database in
// `custom-items.db.test.ts`. This file mocks that module at the seam and
// asserts what the route owns: the session, the household, the body, and the
// status each outcome maps to (HON-1208).

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

vi.mock('@/lib/shopping/custom-items', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shopping/custom-items')>()),
  updateCustomShoppingItem: vi.fn(),
  deleteCustomShoppingItem: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { deleteCustomShoppingItem, updateCustomShoppingItem } from '@/lib/shopping/custom-items'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockCaptureApiError = vi.mocked(captureApiError)
const mockUpdate = vi.mocked(updateCustomShoppingItem)
const mockDelete = vi.mocked(deleteCustomShoppingItem)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
} as never

const membership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: { id: 'household-123', name: 'Test', timezone: 'Europe/Tallinn', locale: 'en' },
} as never

const item = {
  id: 'custom-1',
  householdId: 'household-123',
  name: 'Salt',
  checked: true,
  ingredientId: 'ing-salt',
  createdAt: '2026-10-15T08:00:00.000Z',
  ingredient: { id: 'ing-salt', name: 'Salt', category: 'spice' },
}

function patch(id: string, body?: unknown, bodyString?: string) {
  return PATCH(
    new Request(`http://localhost/api/shopping-list/custom/${id}`, {
      method: 'PATCH',
      body: bodyString ?? (body !== undefined ? JSON.stringify(body) : undefined),
    }),
    { params: Promise.resolve({ id }) },
  )
}

function del(id: string) {
  return DELETE(
    new Request(`http://localhost/api/shopping-list/custom/${id}`, { method: 'DELETE' }),
    {
      params: Promise.resolve({ id }),
    },
  )
}

async function answer(response: Promise<Response>) {
  const res = await response
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(mockSession)
  mockGetMembership.mockResolvedValue(membership)
})

describe('PATCH /api/shopping-list/custom/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(patch('custom-1', { checked: true }))).toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(patch('custom-1', { checked: true }))).toEqual({
      status: 404,
      body: { error: 'No household found' },
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid JSON', async () => {
    expect(await answer(patch('custom-1', undefined, 'not valid json'))).toEqual({
      status: 400,
      body: { error: 'Invalid JSON' },
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 with details when checked is not a boolean', async () => {
    const { status, body } = await answer(patch('custom-1', { checked: 'not-a-bool' }))

    expect(status).toBe(400)
    expect(body).toEqual({ error: 'Validation failed', details: { checked: [expect.any(String)] } })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 with details when ingredientId is not a string', async () => {
    const { status, body } = await answer(patch('custom-1', { ingredientId: 42 }))

    expect(status).toBe(400)
    expect(body).toEqual({
      error: 'Validation failed',
      details: { ingredientId: [expect.any(String)] },
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('updates the item for the household and returns 200 with the item alone', async () => {
    mockUpdate.mockResolvedValue({ status: 'updated', item, replacedQuantity: 300 } as never)

    expect(await answer(patch('custom-1', { checked: true, ingredientId: 'ing-salt' }))).toEqual({
      status: 200,
      body: { item },
    })
    expect(mockUpdate).toHaveBeenCalledWith('household-123', 'custom-1', {
      checked: true,
      ingredientId: 'ing-salt',
    })
  })

  it('passes a null ingredientId through to unlink the item', async () => {
    mockUpdate.mockResolvedValue({ status: 'updated', item, replacedQuantity: null } as never)

    expect((await patch('custom-1', { ingredientId: null })).status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith('household-123', 'custom-1', { ingredientId: null })
  })

  it('returns 404 when the household has no item with this id', async () => {
    mockUpdate.mockResolvedValue({ status: 'not_found' })

    expect(await answer(patch('custom-nope', { checked: true }))).toEqual({
      status: 404,
      body: { error: 'Item not found' },
    })
  })

  it('returns 400 when the ingredient is not available to the household', async () => {
    mockUpdate.mockResolvedValue({ status: 'ingredient_not_found' })

    expect(await answer(patch('custom-1', { ingredientId: 'ing-other' }))).toEqual({
      status: 400,
      body: { error: 'Ingredient not found' },
    })
  })

  it('returns 500 and reports the error when the update throws', async () => {
    const error = new Error('db down')
    mockUpdate.mockRejectedValue(error)

    expect(await answer(patch('custom-1', { checked: true }))).toEqual({
      status: 500,
      body: { error: 'Failed to update item' },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(error, {
      route: '/api/shopping-list/custom/[id]',
      userId: 'user-123',
    })
  })
})

describe('DELETE /api/shopping-list/custom/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await answer(del('custom-1'))).toEqual({
      status: 401,
      body: { error: 'Unauthorized' },
    })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('returns 404 when user has no household', async () => {
    mockGetMembership.mockResolvedValue(null)

    expect(await answer(del('custom-1'))).toEqual({
      status: 404,
      body: { error: 'No household found' },
    })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("deletes the household's item and returns success", async () => {
    mockDelete.mockResolvedValue(true)

    expect(await answer(del('custom-1'))).toEqual({ status: 200, body: { success: true } })
    expect(mockDelete).toHaveBeenCalledWith('household-123', 'custom-1')
  })

  it('returns 404 when the household has no item with this id', async () => {
    mockDelete.mockResolvedValue(false)

    expect(await answer(del('custom-nope'))).toEqual({
      status: 404,
      body: { error: 'Item not found' },
    })
  })

  it('returns 500 and reports the error when the delete throws', async () => {
    const error = new Error('db down')
    mockDelete.mockRejectedValue(error)

    expect(await answer(del('custom-1'))).toEqual({
      status: 500,
      body: { error: 'Failed to delete item' },
    })
    expect(mockCaptureApiError).toHaveBeenCalledWith(error, {
      route: '/api/shopping-list/custom/[id]',
      userId: 'user-123',
    })
  })
})
