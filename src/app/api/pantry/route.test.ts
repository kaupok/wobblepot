import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'

function createMockRequest(url: string = 'http://localhost/api/pantry') {
  return new NextRequest(url)
}

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
      count: vi.fn(),
    },
    pantryItem: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    ingredient: {
      findUnique: vi.fn(),
    },
    mealPlanEntry: {
      findMany: vi.fn(),
    },
  },
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockMemberCount = vi.mocked(prisma.householdMember.count)
const mockFindMany = vi.mocked(prisma.pantryItem.findMany)
const mockFindUniquePantry = vi.mocked(prisma.pantryItem.findUnique)
const mockCreatePantry = vi.mocked(prisma.pantryItem.create)
const mockFindUniqueIngredient = vi.mocked(prisma.ingredient.findUnique)
const mockFindManyEntries = vi.mocked(prisma.mealPlanEntry.findMany)

const mockHousehold = {
  id: 'household-123',
  name: 'Test Household',
  timezone: 'Europe/Tallinn',
  locale: 'en',
  preferences: null,
}

const mockMembership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: mockHousehold,
}

const mockIngredient = {
  id: 'ing-456',
  name: 'Olive oil',
  category: 'fat',
  defaultUnit: 'g',
}

describe('GET /api/pantry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET(createMockRequest())
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(null)

    const response = await GET(createMockRequest())
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns pantry items sorted by staples first then name', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)

    const mockItems = [
      {
        id: 'pantry-1',
        householdId: 'household-123',
        ingredientId: 'ing-1',
        quantity: null,
        isStaple: true,
        updatedAt: new Date('2024-01-01'),
        ingredient: { id: 'ing-1', name: 'Olive oil', category: 'fat', defaultUnit: 'g' },
      },
      {
        id: 'pantry-2',
        householdId: 'household-123',
        ingredientId: 'ing-2',
        quantity: 500,
        isStaple: false,
        updatedAt: new Date('2024-01-05'),
        ingredient: { id: 'ing-2', name: 'Chicken breast', category: 'protein', defaultUnit: 'g' },
      },
    ]
    mockFindMany.mockResolvedValue(mockItems as never)

    const response = await GET(createMockRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.items).toHaveLength(2)
    expect(data.items[0].isStaple).toBe(true)
    expect(data.items[0].ingredient.name).toBe('Olive oil')
    expect(data.items[1].quantity).toBe(500)
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { householdId: 'household-123' },
      include: {
        ingredient: {
          select: { id: true, name: true, category: true, defaultUnit: true, gramsPerPiece: true },
        },
      },
      orderBy: [{ isStaple: 'desc' }, { ingredient: { name: 'asc' } }],
    })
  })

  it('returns empty items array when pantry is empty', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindMany.mockResolvedValue([])

    const response = await GET(createMockRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.items).toEqual([])
  })

  it('returns needed quantities when days param is provided', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockMemberCount.mockResolvedValue(2)

    const mockItems = [
      {
        id: 'pantry-1',
        householdId: 'household-123',
        ingredientId: 'ing-1',
        quantity: null,
        isStaple: false,
        updatedAt: new Date('2024-01-01'),
        ingredient: {
          id: 'ing-1',
          name: 'Chicken breast',
          category: 'protein',
          defaultUnit: 'g',
          gramsPerPiece: null,
        },
      },
    ]
    mockFindMany.mockResolvedValue(mockItems as never)

    // Mock meal plan entries with components
    const mockEntries = [
      {
        id: 'entry-1',
        date: new Date(),
        status: 'planned',
        meal: {
          components: [
            { ingredientId: 'ing-1', quantityPerServing: 150 },
            { ingredientId: 'ing-2', quantityPerServing: 100 },
          ],
        },
      },
      {
        id: 'entry-2',
        date: new Date(),
        status: 'planned',
        meal: {
          components: [{ ingredientId: 'ing-1', quantityPerServing: 200 }],
        },
      },
    ]
    mockFindManyEntries.mockResolvedValue(mockEntries as never)

    const response = await GET(createMockRequest('http://localhost/api/pantry?days=7'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.windowDays).toBe(7)
    expect(data.items).toHaveLength(1)
    // Household size 2, so (150 + 200) * 2 = 700g
    expect(data.items[0].neededQuantity).toBe(700)
    expect(data.items[0].neededDisplayQuantity).toBe('700g')
    expect(data.items[0].windowDays).toBe(7)
  })

  it('does not include needed quantities when days param is not provided', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)

    const mockItems = [
      {
        id: 'pantry-1',
        householdId: 'household-123',
        ingredientId: 'ing-1',
        quantity: null,
        isStaple: false,
        updatedAt: new Date('2024-01-01'),
        ingredient: {
          id: 'ing-1',
          name: 'Chicken breast',
          category: 'protein',
          defaultUnit: 'g',
          gramsPerPiece: null,
        },
      },
    ]
    mockFindMany.mockResolvedValue(mockItems as never)

    const response = await GET(createMockRequest())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.windowDays).toBeNull()
    expect(data.items[0].neededQuantity).toBeUndefined()
    expect(data.items[0].neededDisplayQuantity).toBeUndefined()
    expect(data.items[0].windowDays).toBeUndefined()
  })

  it('formats piece-based ingredients correctly', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockMemberCount.mockResolvedValue(2)

    const mockItems = [
      {
        id: 'pantry-1',
        householdId: 'household-123',
        ingredientId: 'ing-1',
        quantity: null,
        isStaple: false,
        updatedAt: new Date('2024-01-01'),
        ingredient: {
          id: 'ing-1',
          name: 'Eggs',
          category: 'protein',
          defaultUnit: 'piece',
          gramsPerPiece: 60,
        },
      },
    ]
    mockFindMany.mockResolvedValue(mockItems as never)

    // Mock meal plan entries - needs 180g which is 3 eggs at 60g each
    const mockEntries = [
      {
        id: 'entry-1',
        date: new Date(),
        status: 'planned',
        meal: {
          components: [{ ingredientId: 'ing-1', quantityPerServing: 90 }],
        },
      },
    ]
    mockFindManyEntries.mockResolvedValue(mockEntries as never)

    const response = await GET(createMockRequest('http://localhost/api/pantry?days=7'))
    const data = await response.json()

    expect(response.status).toBe(200)
    // Household size 2, so 90 * 2 = 180g, divided by 60g per piece = 3 eggs
    expect(data.items[0].neededDisplayQuantity).toBe('3')
  })
})

describe('POST /api/pantry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const request = new Request('http://localhost/api/pantry', {
      method: 'POST',
      body: JSON.stringify({ ingredientId: 'ing-456' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 400 for invalid JSON', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const request = new Request('http://localhost/api/pantry', {
      method: 'POST',
      body: 'not valid json',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 400 when ingredientId is missing', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const request = new Request('http://localhost/api/pantry', {
      method: 'POST',
      body: JSON.stringify({}),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details.ingredientId).toBeDefined()
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(null)

    const request = new Request('http://localhost/api/pantry', {
      method: 'POST',
      body: JSON.stringify({ ingredientId: 'ing-456' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 404 when ingredient does not exist', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniqueIngredient.mockResolvedValue(null)

    const request = new Request('http://localhost/api/pantry', {
      method: 'POST',
      body: JSON.stringify({ ingredientId: 'nonexistent' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Ingredient not found')
  })

  it('returns 409 when ingredient already in pantry', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniqueIngredient.mockResolvedValue(mockIngredient as never)
    mockFindUniquePantry.mockResolvedValue({
      id: 'existing-pantry-item',
      householdId: 'household-123',
      ingredientId: 'ing-456',
    } as never)

    const request = new Request('http://localhost/api/pantry', {
      method: 'POST',
      body: JSON.stringify({ ingredientId: 'ing-456' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Ingredient already in pantry')
    expect(data.existingId).toBe('existing-pantry-item')
  })

  it('creates pantry item with defaults', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniqueIngredient.mockResolvedValue(mockIngredient as never)
    mockFindUniquePantry.mockResolvedValue(null)

    const createdItem = {
      id: 'pantry-new',
      householdId: 'household-123',
      ingredientId: 'ing-456',
      quantity: null,
      isStaple: false,
      updatedAt: new Date('2024-01-10'),
      ingredient: mockIngredient,
    }
    mockCreatePantry.mockResolvedValue(createdItem as never)

    const request = new Request('http://localhost/api/pantry', {
      method: 'POST',
      body: JSON.stringify({ ingredientId: 'ing-456' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.id).toBe('pantry-new')
    expect(data.quantity).toBe(null)
    expect(data.isStaple).toBe(false)
    expect(data.ingredient.name).toBe('Olive oil')
    expect(mockCreatePantry).toHaveBeenCalledWith({
      data: {
        householdId: 'household-123',
        ingredientId: 'ing-456',
        quantity: null,
        isStaple: false,
      },
      include: {
        ingredient: {
          select: { id: true, name: true, category: true, defaultUnit: true },
        },
      },
    })
  })

  it('creates pantry item with quantity and isStaple', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniqueIngredient.mockResolvedValue(mockIngredient as never)
    mockFindUniquePantry.mockResolvedValue(null)

    const createdItem = {
      id: 'pantry-new',
      householdId: 'household-123',
      ingredientId: 'ing-456',
      quantity: 500,
      isStaple: true,
      updatedAt: new Date('2024-01-10'),
      ingredient: mockIngredient,
    }
    mockCreatePantry.mockResolvedValue(createdItem as never)

    const request = new Request('http://localhost/api/pantry', {
      method: 'POST',
      body: JSON.stringify({ ingredientId: 'ing-456', quantity: 500, isStaple: true }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.quantity).toBe(500)
    expect(data.isStaple).toBe(true)
    expect(mockCreatePantry).toHaveBeenCalledWith({
      data: {
        householdId: 'household-123',
        ingredientId: 'ing-456',
        quantity: 500,
        isStaple: true,
      },
      include: {
        ingredient: {
          select: { id: true, name: true, category: true, defaultUnit: true },
        },
      },
    })
  })

  it('creates pantry item with explicit null quantity', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockFindUniqueIngredient.mockResolvedValue(mockIngredient as never)
    mockFindUniquePantry.mockResolvedValue(null)

    const createdItem = {
      id: 'pantry-new',
      householdId: 'household-123',
      ingredientId: 'ing-456',
      quantity: null,
      isStaple: false,
      updatedAt: new Date('2024-01-10'),
      ingredient: mockIngredient,
    }
    mockCreatePantry.mockResolvedValue(createdItem as never)

    const request = new Request('http://localhost/api/pantry', {
      method: 'POST',
      body: JSON.stringify({ ingredientId: 'ing-456', quantity: null }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.quantity).toBe(null)
  })
})
