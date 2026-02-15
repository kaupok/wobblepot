import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, PATCH } from './route'

// Mock dependencies
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
    householdPreferences: {
      update: vi.fn(),
    },
  },
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockUpdate = vi.mocked(prisma.householdPreferences.update)

const mockPreferences = {
  id: 'prefs-123',
  householdId: 'household-123',
  dietaryType: null,
  allergensToAvoid: [],
  restrictions: [],
  excludedIngredients: [],
  excludedIngredientIds: [],
  weekdayMealTypes: ['dinner'],
  weekendMealTypes: ['dinner'],
}

const mockMembership = {
  id: 'member-123',
  householdId: 'household-123',
  userId: 'user-123',
  role: 'owner',
  household: {
    id: 'household-123',
    name: "John Doe's Household",
    timezone: 'Europe/Tallinn',
    createdAt: new Date('2024-01-01'),
    preferences: mockPreferences,
  },
}

const mockNonOwnerMembership = {
  ...mockMembership,
  id: 'member-456',
  userId: 'user-456',
  role: 'member',
}

describe('GET /api/households/me/preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(null)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns preferences when authenticated', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(mockMembership as never)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.id).toBe('prefs-123')
    expect(data.dietaryType).toBeNull()
    expect(data.weekdayMealTypes).toEqual(['dinner'])
  })
})

describe('PATCH /api/households/me/preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createRequest = (body: object) =>
    new Request('http://localhost/api/households/me/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await PATCH(createRequest({ dietaryType: 'vegetarian' }))
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 400 on invalid dietary type', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const response = await PATCH(createRequest({ dietaryType: 'invalid-type' }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details.dietaryType).toBeDefined()
  })

  it('returns 400 on invalid allergen', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const response = await PATCH(createRequest({ allergensToAvoid: ['invalid-allergen'] }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
  })

  it('returns 400 on invalid meal type', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const response = await PATCH(createRequest({ weekdayMealTypes: ['brunch'] }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
  })

  it('returns 400 on invalid JSON', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const request = new Request('http://localhost/api/households/me/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json{',
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(null)

    const response = await PATCH(createRequest({ dietaryType: 'vegetarian' }))
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('returns 403 when non-owner tries to update preferences', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-456', name: 'Jane Doe', email: 'jane@example.com' },
      session: { id: 'session-456' },
    } as never)

    mockFindFirst.mockResolvedValue(mockNonOwnerMembership as never)

    const response = await PATCH(createRequest({ dietaryType: 'vegetarian' }))
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Only household owners can update preferences')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('updates single field successfully', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(mockMembership as never)

    const updatedPreferences = { ...mockPreferences, dietaryType: 'vegetarian' }
    mockUpdate.mockResolvedValue(updatedPreferences as never)

    const response = await PATCH(createRequest({ dietaryType: 'vegetarian' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.dietaryType).toBe('vegetarian')
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { householdId: 'household-123' },
      data: { dietaryType: 'vegetarian' },
    })
  })

  it('updates multiple fields successfully', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(mockMembership as never)

    const updatedPreferences = {
      ...mockPreferences,
      dietaryType: 'vegan',
      allergensToAvoid: ['gluten', 'dairy'],
      weekdayMealTypes: ['lunch', 'dinner'],
    }
    mockUpdate.mockResolvedValue(updatedPreferences as never)

    const response = await PATCH(
      createRequest({
        dietaryType: 'vegan',
        allergensToAvoid: ['gluten', 'dairy'],
        weekdayMealTypes: ['lunch', 'dinner'],
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.dietaryType).toBe('vegan')
    expect(data.allergensToAvoid).toEqual(['gluten', 'dairy'])
    expect(data.weekdayMealTypes).toEqual(['lunch', 'dinner'])
  })

  it('handles nullable dietaryType', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(mockMembership as never)

    const updatedPreferences = { ...mockPreferences, dietaryType: null }
    mockUpdate.mockResolvedValue(updatedPreferences as never)

    const response = await PATCH(createRequest({ dietaryType: null }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.dietaryType).toBeNull()
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { householdId: 'household-123' },
      data: { dietaryType: null },
    })
  })

  it('updates restrictions array successfully', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(mockMembership as never)

    const updatedPreferences = {
      ...mockPreferences,
      restrictions: ['low sodium', 'Mediterranean-style'],
    }
    mockUpdate.mockResolvedValue(updatedPreferences as never)

    const response = await PATCH(
      createRequest({ restrictions: ['low sodium', 'Mediterranean-style'] }),
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.restrictions).toEqual(['low sodium', 'Mediterranean-style'])
  })

  it('returns 400 on empty weekdayMealTypes array', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const response = await PATCH(createRequest({ weekdayMealTypes: [] }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details.weekdayMealTypes).toContain('At least one weekday meal type required')
  })

  it('returns 400 on empty weekendMealTypes array', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const response = await PATCH(createRequest({ weekendMealTypes: [] }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details.weekendMealTypes).toContain('At least one weekend meal type required')
  })
})
