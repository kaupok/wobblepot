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

vi.mock('@/lib/prisma', () => ({
  prisma: {
    householdMember: {
      findFirst: vi.fn(),
    },
    pantryItem: {
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockFindFirstMember = vi.mocked(prisma.householdMember.findFirst)
const mockFindFirstPantry = vi.mocked(prisma.pantryItem.findFirst)
const mockUpdatePantry = vi.mocked(prisma.pantryItem.update)
const mockDeletePantry = vi.mocked(prisma.pantryItem.delete)

const mockHousehold = {
  id: 'household-123',
  name: 'Test Household',
  timezone: 'Europe/Tallinn',
  preferences: null,
}

const mockMembership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: mockHousehold,
}

const mockPantryItem = {
  id: 'pantry-123',
  householdId: 'household-123',
  ingredientId: 'ing-456',
  quantity: 500,
  isStaple: false,
  updatedAt: new Date('2024-01-10'),
}

const mockIngredient = {
  id: 'ing-456',
  name: 'Olive oil',
  category: 'fat',
  defaultUnit: 'g',
}

describe('PATCH /api/pantry/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const request = new Request('http://localhost/api/pantry/pantry-123', {
      method: 'PATCH',
      body: JSON.stringify({ quantity: 250 }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'pantry-123' }) })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 400 for invalid JSON', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const request = new Request('http://localhost/api/pantry/pantry-123', {
      method: 'PATCH',
      body: 'not valid json',
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'pantry-123' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 400 for invalid quantity type', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const request = new Request('http://localhost/api/pantry/pantry-123', {
      method: 'PATCH',
      body: JSON.stringify({ quantity: 'not a number' }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'pantry-123' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirstMember.mockResolvedValue(null)

    const request = new Request('http://localhost/api/pantry/pantry-123', {
      method: 'PATCH',
      body: JSON.stringify({ quantity: 250 }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'pantry-123' }) })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 404 when pantry item not found', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirstMember.mockResolvedValue(mockMembership as never)
    mockFindFirstPantry.mockResolvedValue(null)

    const request = new Request('http://localhost/api/pantry/nonexistent', {
      method: 'PATCH',
      body: JSON.stringify({ quantity: 250 }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'nonexistent' }) })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Pantry item not found')
  })

  it('returns 404 when pantry item belongs to different household', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirstMember.mockResolvedValue(mockMembership as never)
    // findFirst returns null because householdId doesn't match
    mockFindFirstPantry.mockResolvedValue(null)

    const request = new Request('http://localhost/api/pantry/pantry-other', {
      method: 'PATCH',
      body: JSON.stringify({ quantity: 250 }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'pantry-other' }) })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Pantry item not found')
  })

  it('updates quantity only', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirstMember.mockResolvedValue(mockMembership as never)
    mockFindFirstPantry.mockResolvedValue(mockPantryItem as never)

    const updatedItem = {
      ...mockPantryItem,
      quantity: 250,
      ingredient: mockIngredient,
    }
    mockUpdatePantry.mockResolvedValue(updatedItem as never)

    const request = new Request('http://localhost/api/pantry/pantry-123', {
      method: 'PATCH',
      body: JSON.stringify({ quantity: 250 }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'pantry-123' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quantity).toBe(250)
    expect(mockUpdatePantry).toHaveBeenCalledWith({
      where: { id: 'pantry-123' },
      data: { quantity: 250 },
      include: {
        ingredient: {
          select: { id: true, name: true, category: true, defaultUnit: true },
        },
      },
    })
  })

  it('updates isStaple only', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirstMember.mockResolvedValue(mockMembership as never)
    mockFindFirstPantry.mockResolvedValue(mockPantryItem as never)

    const updatedItem = {
      ...mockPantryItem,
      isStaple: true,
      ingredient: mockIngredient,
    }
    mockUpdatePantry.mockResolvedValue(updatedItem as never)

    const request = new Request('http://localhost/api/pantry/pantry-123', {
      method: 'PATCH',
      body: JSON.stringify({ isStaple: true }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'pantry-123' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.isStaple).toBe(true)
    expect(mockUpdatePantry).toHaveBeenCalledWith({
      where: { id: 'pantry-123' },
      data: { isStaple: true },
      include: {
        ingredient: {
          select: { id: true, name: true, category: true, defaultUnit: true },
        },
      },
    })
  })

  it('updates both quantity and isStaple', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirstMember.mockResolvedValue(mockMembership as never)
    mockFindFirstPantry.mockResolvedValue(mockPantryItem as never)

    const updatedItem = {
      ...mockPantryItem,
      quantity: 0,
      isStaple: true,
      ingredient: mockIngredient,
    }
    mockUpdatePantry.mockResolvedValue(updatedItem as never)

    const request = new Request('http://localhost/api/pantry/pantry-123', {
      method: 'PATCH',
      body: JSON.stringify({ quantity: 0, isStaple: true }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'pantry-123' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quantity).toBe(0)
    expect(data.isStaple).toBe(true)
    expect(mockUpdatePantry).toHaveBeenCalledWith({
      where: { id: 'pantry-123' },
      data: { quantity: 0, isStaple: true },
      include: {
        ingredient: {
          select: { id: true, name: true, category: true, defaultUnit: true },
        },
      },
    })
  })

  it('updates quantity to null', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirstMember.mockResolvedValue(mockMembership as never)
    mockFindFirstPantry.mockResolvedValue(mockPantryItem as never)

    const updatedItem = {
      ...mockPantryItem,
      quantity: null,
      ingredient: mockIngredient,
    }
    mockUpdatePantry.mockResolvedValue(updatedItem as never)

    const request = new Request('http://localhost/api/pantry/pantry-123', {
      method: 'PATCH',
      body: JSON.stringify({ quantity: null }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'pantry-123' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quantity).toBe(null)
    expect(mockUpdatePantry).toHaveBeenCalledWith({
      where: { id: 'pantry-123' },
      data: { quantity: null },
      include: {
        ingredient: {
          select: { id: true, name: true, category: true, defaultUnit: true },
        },
      },
    })
  })

  it('handles empty body gracefully (no updates)', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirstMember.mockResolvedValue(mockMembership as never)
    mockFindFirstPantry.mockResolvedValue(mockPantryItem as never)

    const updatedItem = {
      ...mockPantryItem,
      ingredient: mockIngredient,
    }
    mockUpdatePantry.mockResolvedValue(updatedItem as never)

    const request = new Request('http://localhost/api/pantry/pantry-123', {
      method: 'PATCH',
      body: JSON.stringify({}),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'pantry-123' }) })
    await response.json()

    expect(response.status).toBe(200)
    expect(mockUpdatePantry).toHaveBeenCalledWith({
      where: { id: 'pantry-123' },
      data: {},
      include: {
        ingredient: {
          select: { id: true, name: true, category: true, defaultUnit: true },
        },
      },
    })
  })

  it('returns 500 with the { error } JSON shape when the update throws', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirstMember.mockResolvedValue(mockMembership as never)
    mockFindFirstPantry.mockResolvedValue(mockPantryItem as never)
    mockUpdatePantry.mockRejectedValue(new Error('db down'))

    const request = new Request('http://localhost/api/pantry/pantry-123', {
      method: 'PATCH',
      body: JSON.stringify({ isStaple: true }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'pantry-123' }) })
    const data = await response.json()

    expect(response.status).toBe(500)
    // `apiFetch` parses the body and surfaces `error` — a bare Next.js 500
    // would not be JSON at all, which is the regression this guards.
    expect(typeof data.error).toBe('string')
    expect(data.error.length).toBeGreaterThan(0)
  })

  it('still returns 400 for malformed JSON — the inner catch wins over the outer one', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const request = new Request('http://localhost/api/pantry/pantry-123', {
      method: 'PATCH',
      body: 'not json',
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'pantry-123' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
  })
})

describe('DELETE /api/pantry/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const request = new Request('http://localhost/api/pantry/pantry-123', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: 'pantry-123' }) })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirstMember.mockResolvedValue(null)

    const request = new Request('http://localhost/api/pantry/pantry-123', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: 'pantry-123' }) })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 404 when pantry item not found', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirstMember.mockResolvedValue(mockMembership as never)
    mockFindFirstPantry.mockResolvedValue(null)

    const request = new Request('http://localhost/api/pantry/nonexistent', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: 'nonexistent' }) })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Pantry item not found')
  })

  it('deletes pantry item and returns 204', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirstMember.mockResolvedValue(mockMembership as never)
    mockFindFirstPantry.mockResolvedValue(mockPantryItem as never)
    mockDeletePantry.mockResolvedValue(mockPantryItem as never)

    const request = new Request('http://localhost/api/pantry/pantry-123', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: 'pantry-123' }) })

    expect(response.status).toBe(204)
    expect(mockDeletePantry).toHaveBeenCalledWith({
      where: { id: 'pantry-123' },
    })
  })

  it('returns 500 with the { error } JSON shape when the delete throws', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirstMember.mockResolvedValue(mockMembership as never)
    mockFindFirstPantry.mockResolvedValue(mockPantryItem as never)
    mockDeletePantry.mockRejectedValue(new Error('db down'))

    const request = new Request('http://localhost/api/pantry/pantry-123', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: 'pantry-123' }) })
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(typeof data.error).toBe('string')
    expect(data.error.length).toBeGreaterThan(0)
  })
})
