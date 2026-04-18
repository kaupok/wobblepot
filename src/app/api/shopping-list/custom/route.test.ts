import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

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
      create: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockFindUnique = vi.mocked(prisma.customShoppingItem.findUnique)
const mockUpdate = vi.mocked(prisma.customShoppingItem.update)
const mockCreate = vi.mocked(prisma.customShoppingItem.create)
const mockQueryRaw = vi.mocked(prisma.$queryRaw)

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

function createRequest(body?: unknown, bodyString?: string) {
  return new Request('http://localhost/api/shopping-list/custom', {
    method: 'POST',
    body:
      bodyString !== undefined ? bodyString : body !== undefined ? JSON.stringify(body) : undefined,
  })
}

describe('POST /api/shopping-list/custom', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no fuzzy match
    mockQueryRaw.mockResolvedValue([] as never)
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await POST(createRequest({ name: 'Salt' }))
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const response = await POST(createRequest({ name: 'Salt' }))
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 400 for invalid JSON', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await POST(createRequest(undefined, 'not valid json'))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 400 when name is empty', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await POST(createRequest({ name: '' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details.name).toBeDefined()
  })

  it('returns 400 when name exceeds 200 chars', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)

    const response = await POST(createRequest({ name: 'x'.repeat(201) }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details.name).toBeDefined()
  })

  it('unchecks and returns 200 when item already exists and is checked (re-add)', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue({
      id: 'custom-1',
      householdId: 'household-123',
      name: 'Salt',
      checked: true,
      ingredientId: null,
    } as never)
    mockUpdate.mockResolvedValue({
      id: 'custom-1',
      householdId: 'household-123',
      name: 'Salt',
      checked: false,
      ingredientId: null,
      ingredient: null,
    } as never)

    const response = await POST(createRequest({ name: 'Salt' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.item.checked).toBe(false)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'custom-1' },
      data: { checked: false },
      include: expect.any(Object),
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 409 when unchecked duplicate exists', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    const existing = {
      id: 'custom-1',
      householdId: 'household-123',
      name: 'Salt',
      checked: false,
      ingredientId: null,
    }
    mockFindUnique.mockResolvedValue(existing as never)

    const response = await POST(createRequest({ name: 'Salt' }))
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Item already exists')
    expect(data.existing.id).toBe('custom-1')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('creates item with no match when fuzzy search returns nothing', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue(null)
    mockQueryRaw.mockResolvedValue([] as never)
    mockCreate.mockResolvedValue({
      id: 'custom-new',
      householdId: 'household-123',
      name: 'Weird thing',
      checked: false,
      ingredientId: null,
      ingredient: null,
    } as never)

    const response = await POST(createRequest({ name: 'Weird thing' }))
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.item.id).toBe('custom-new')
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        householdId: 'household-123',
        name: 'Weird thing',
        ingredientId: null,
      },
      include: expect.any(Object),
    })
  })

  it('creates item with matched ingredient when fuzzy search hits', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue(null)
    mockQueryRaw.mockResolvedValue([
      { id: 'ing-salt', name: 'Salt', category: 'seasoning', similarity: 0.9 },
    ] as never)
    mockCreate.mockResolvedValue({
      id: 'custom-new',
      householdId: 'household-123',
      name: 'Salt',
      checked: false,
      ingredientId: 'ing-salt',
      ingredient: { id: 'ing-salt', name: 'Salt', category: 'seasoning' },
    } as never)

    const response = await POST(createRequest({ name: 'Salt' }))
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.item.ingredientId).toBe('ing-salt')
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        householdId: 'household-123',
        name: 'Salt',
        ingredientId: 'ing-salt',
      },
      include: expect.any(Object),
    })
  })

  it('swallows fuzzy search failure and creates item without match', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue(null)
    mockQueryRaw.mockRejectedValue(new Error('similarity extension missing'))
    mockCreate.mockResolvedValue({
      id: 'custom-new',
      householdId: 'household-123',
      name: 'Salt',
      checked: false,
      ingredientId: null,
      ingredient: null,
    } as never)

    const response = await POST(createRequest({ name: 'Salt' }))
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        householdId: 'household-123',
        name: 'Salt',
        ingredientId: null,
      },
      include: expect.any(Object),
    })
  })

  it('returns 409 when Prisma throws P2002 unique violation', async () => {
    const { Prisma } = await import('@/generated/prisma/client')
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue(null)
    mockCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    )

    const response = await POST(createRequest({ name: 'Salt' }))
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Item already exists')
  })

  it('returns 500 when Prisma throws a generic error', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockFindUnique.mockResolvedValue(null)
    mockCreate.mockRejectedValue(new Error('DB down'))

    const response = await POST(createRequest({ name: 'Salt' }))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to create item')
  })
})
