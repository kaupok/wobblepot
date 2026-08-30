import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PATCH, DELETE } from './route'

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
    customShoppingItem: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    pantryItem: {
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockFindUnique = vi.mocked(prisma.customShoppingItem.findUnique)
const mockDelete = vi.mocked(prisma.customShoppingItem.delete)
const mockTransaction = vi.mocked(prisma.$transaction)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
}

const mockMembership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: {
    id: 'household-123',
    name: 'Test Household',
    timezone: 'Europe/Tallinn',
    preferences: null,
  },
}

function patchRequest(id: string, body?: unknown, bodyString?: string) {
  return PATCH(
    new Request(`http://localhost/api/shopping-list/custom/${id}`, {
      method: 'PATCH',
      body:
        bodyString !== undefined
          ? bodyString
          : body !== undefined
            ? JSON.stringify(body)
            : undefined,
    }),
    { params: Promise.resolve({ id }) },
  )
}

function deleteRequest(id: string) {
  return DELETE(
    new Request(`http://localhost/api/shopping-list/custom/${id}`, { method: 'DELETE' }),
    {
      params: Promise.resolve({ id }),
    },
  )
}

describe('PATCH /api/shopping-list/custom/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await patchRequest('custom-1', { checked: true })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const response = await patchRequest('custom-1', { checked: true })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 404 when item does not exist', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue(null)

    const response = await patchRequest('custom-nope', { checked: true })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Item not found')
  })

  it('returns 404 when item belongs to a different household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue({
      id: 'custom-1',
      householdId: 'household-OTHER',
      name: 'Salt',
      checked: false,
      ingredientId: null,
    } as never)

    const response = await patchRequest('custom-1', { checked: true })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Item not found')
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid JSON', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue({
      id: 'custom-1',
      householdId: 'household-123',
      name: 'Salt',
      checked: false,
      ingredientId: null,
    } as never)

    const response = await patchRequest('custom-1', undefined, 'not valid json')
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 400 for invalid schema (bad checked type)', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue({
      id: 'custom-1',
      householdId: 'household-123',
      name: 'Salt',
      checked: false,
      ingredientId: null,
    } as never)

    const response = await patchRequest('custom-1', { checked: 'not-a-bool' })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
  })

  it('toggles checked=true on unlinked item without pantry upsert', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue({
      id: 'custom-1',
      householdId: 'household-123',
      name: 'Random thing',
      checked: false,
      ingredientId: null,
    } as never)

    const txUpdateSpy = vi.fn().mockResolvedValue({
      id: 'custom-1',
      householdId: 'household-123',
      name: 'Random thing',
      checked: true,
      ingredientId: null,
      ingredient: null,
    })
    const txUpsertSpy = vi.fn()

    mockTransaction.mockImplementation(async (fn) => {
      const tx = {
        customShoppingItem: { update: txUpdateSpy },
        pantryItem: { upsert: txUpsertSpy },
      }
      return (fn as (t: unknown) => Promise<unknown>)(tx)
    })

    const response = await patchRequest('custom-1', { checked: true })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.item.checked).toBe(true)
    expect(txUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'custom-1' }, data: { checked: true } }),
    )
    expect(txUpsertSpy).not.toHaveBeenCalled()
  })

  it('toggles checked=true on linked item and upserts pantry', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue({
      id: 'custom-1',
      householdId: 'household-123',
      name: 'Salt',
      checked: false,
      ingredientId: 'ing-salt',
    } as never)

    const txUpdateSpy = vi.fn().mockResolvedValue({
      id: 'custom-1',
      householdId: 'household-123',
      name: 'Salt',
      checked: true,
      ingredientId: 'ing-salt',
      ingredient: { id: 'ing-salt', name: 'Salt', category: 'seasoning' },
    })
    const txUpsertSpy = vi.fn()

    mockTransaction.mockImplementation(async (fn) => {
      const tx = {
        customShoppingItem: { update: txUpdateSpy },
        pantryItem: { upsert: txUpsertSpy },
      }
      return (fn as (t: unknown) => Promise<unknown>)(tx)
    })

    const response = await patchRequest('custom-1', { checked: true })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.item.checked).toBe(true)
    expect(txUpsertSpy).toHaveBeenCalledWith({
      where: {
        householdId_ingredientId: {
          householdId: 'household-123',
          ingredientId: 'ing-salt',
        },
      },
      create: {
        householdId: 'household-123',
        ingredientId: 'ing-salt',
        quantity: null,
        isStaple: false,
      },
      update: {},
    })
  })

  it('does not upsert pantry when unchecking a linked item', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue({
      id: 'custom-1',
      householdId: 'household-123',
      name: 'Salt',
      checked: true,
      ingredientId: 'ing-salt',
    } as never)

    const txUpdateSpy = vi.fn().mockResolvedValue({
      id: 'custom-1',
      householdId: 'household-123',
      name: 'Salt',
      checked: false,
      ingredientId: 'ing-salt',
      ingredient: { id: 'ing-salt', name: 'Salt', category: 'seasoning' },
    })
    const txUpsertSpy = vi.fn()

    mockTransaction.mockImplementation(async (fn) => {
      const tx = {
        customShoppingItem: { update: txUpdateSpy },
        pantryItem: { upsert: txUpsertSpy },
      }
      return (fn as (t: unknown) => Promise<unknown>)(tx)
    })

    const response = await patchRequest('custom-1', { checked: false })

    expect(response.status).toBe(200)
    expect(txUpsertSpy).not.toHaveBeenCalled()
  })

  it('updates ingredientId without toggling checked', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue({
      id: 'custom-1',
      householdId: 'household-123',
      name: 'Salt',
      checked: false,
      ingredientId: null,
    } as never)

    const txUpdateSpy = vi.fn().mockResolvedValue({
      id: 'custom-1',
      householdId: 'household-123',
      name: 'Salt',
      checked: false,
      ingredientId: 'ing-salt',
      ingredient: { id: 'ing-salt', name: 'Salt', category: 'seasoning' },
    })
    const txUpsertSpy = vi.fn()

    mockTransaction.mockImplementation(async (fn) => {
      const tx = {
        customShoppingItem: { update: txUpdateSpy },
        pantryItem: { upsert: txUpsertSpy },
      }
      return (fn as (t: unknown) => Promise<unknown>)(tx)
    })

    const response = await patchRequest('custom-1', { ingredientId: 'ing-salt' })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.item.ingredientId).toBe('ing-salt')
    expect(txUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'custom-1' },
        data: { ingredientId: 'ing-salt' },
      }),
    )
    expect(txUpsertSpy).not.toHaveBeenCalled()
  })

  it('returns 500 with the { error } JSON shape when the transaction throws', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue({
      id: 'custom-1',
      householdId: 'household-123',
      name: 'Salt',
      checked: false,
      ingredientId: null,
    } as never)
    mockTransaction.mockRejectedValue(new Error('db down'))

    const response = await patchRequest('custom-1', { checked: true })
    const data = await response.json()

    expect(response.status).toBe(500)
    // `apiFetch` parses the body and surfaces `error` — a bare Next.js 500
    // would not be JSON at all, which is the regression this guards.
    expect(typeof data.error).toBe('string')
    expect(data.error.length).toBeGreaterThan(0)
  })

  it('still returns 400 for malformed JSON — the inner catch wins over the outer one', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue({
      id: 'custom-1',
      householdId: 'household-123',
      name: 'Salt',
    } as never)

    const response = await patchRequest('custom-1', undefined, 'not json')
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
  })
})

describe('DELETE /api/shopping-list/custom/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await deleteRequest('custom-1')
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const response = await deleteRequest('custom-1')
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 404 when item does not exist', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue(null)

    const response = await deleteRequest('custom-nope')
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Item not found')
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('returns 404 when item belongs to a different household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue({
      id: 'custom-1',
      householdId: 'household-OTHER',
      name: 'Salt',
    } as never)

    const response = await deleteRequest('custom-1')
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Item not found')
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('deletes the item and returns success', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue({
      id: 'custom-1',
      householdId: 'household-123',
      name: 'Salt',
    } as never)
    mockDelete.mockResolvedValue({} as never)

    const response = await deleteRequest('custom-1')
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'custom-1' } })
  })

  it('returns 500 with the { error } JSON shape when the delete throws', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue({
      id: 'custom-1',
      householdId: 'household-123',
      name: 'Salt',
    } as never)
    mockDelete.mockRejectedValue(new Error('db down'))

    const response = await deleteRequest('custom-1')
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(typeof data.error).toBe('string')
    expect(data.error.length).toBeGreaterThan(0)
  })
})
