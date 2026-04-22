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
    household: {
      update: vi.fn(),
    },
  },
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockHouseholdUpdate = vi.mocked(prisma.household.update)

describe('GET /api/households/me', () => {
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

  it('returns household with preferences when authenticated', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const mockHousehold = {
      id: 'household-123',
      name: "John Doe's Household",
      timezone: 'Europe/Tallinn',
      createdAt: new Date('2024-01-01'),
      preferences: {
        id: 'prefs-123',
        householdId: 'household-123',
        dietaryType: null,
        allergensToAvoid: [],
        restrictions: [],
        excludedIngredients: [],
        weekdayMealTypes: ['dinner'],
        weekendMealTypes: ['dinner'],
      },
    }

    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: mockHousehold,
    } as never)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.id).toBe('household-123')
    expect(data.name).toBe("John Doe's Household")
    expect(data.timezone).toBe('Europe/Tallinn')
    expect(data.preferences).toBeDefined()
    expect(data.preferences.dietaryType).toBeNull()
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-789', name: 'Bob', email: 'bob@example.com' },
      session: { id: 'session-789' },
    } as never)

    mockFindFirst.mockResolvedValue(null)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })
})

describe('PATCH /api/households/me', () => {
  const mockHousehold = {
    id: 'household-123',
    name: "John Doe's Household",
    timezone: 'Europe/Tallinn',
    createdAt: new Date('2024-01-01'),
    preferences: {
      id: 'prefs-123',
      householdId: 'household-123',
      dietaryType: null,
      allergensToAvoid: [],
      restrictions: [],
      excludedIngredients: [],
      weekdayMealTypes: ['dinner'],
      weekendMealTypes: ['dinner'],
    },
  }

  const mockMembership = {
    id: 'member-123',
    householdId: 'household-123',
    userId: 'user-123',
    role: 'owner',
    household: mockHousehold,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New Name' }),
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 400 for invalid JSON', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const request = new Request('http://localhost/api/households/me', {
      method: 'PATCH',
      body: 'not valid json',
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 400 for name too short', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const request = new Request('http://localhost/api/households/me', {
      method: 'PATCH',
      body: JSON.stringify({ name: '' }),
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details.name).toBeDefined()
  })

  it('returns 400 for name too long', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const request = new Request('http://localhost/api/households/me', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'a'.repeat(101) }),
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details.name).toBeDefined()
  })

  it('returns 400 for invalid timezone', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const request = new Request('http://localhost/api/households/me', {
      method: 'PATCH',
      body: JSON.stringify({ timezone: 'Invalid/Timezone' }),
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details.timezone).toBeDefined()
  })

  it('returns 404 when no household found', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New Name' }),
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('updates name only', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)

    const updatedHousehold = { ...mockHousehold, name: 'New Household Name' }
    mockHouseholdUpdate.mockResolvedValue(updatedHousehold as never)

    const request = new Request('http://localhost/api/households/me', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New Household Name' }),
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.name).toBe('New Household Name')
    expect(mockHouseholdUpdate).toHaveBeenCalledWith({
      where: { id: 'household-123' },
      data: { name: 'New Household Name' },
      include: { preferences: true },
    })
  })

  it('updates timezone only', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)

    const updatedHousehold = { ...mockHousehold, timezone: 'America/New_York' }
    mockHouseholdUpdate.mockResolvedValue(updatedHousehold as never)

    const request = new Request('http://localhost/api/households/me', {
      method: 'PATCH',
      body: JSON.stringify({ timezone: 'America/New_York' }),
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.timezone).toBe('America/New_York')
    expect(mockHouseholdUpdate).toHaveBeenCalledWith({
      where: { id: 'household-123' },
      data: { timezone: 'America/New_York' },
      include: { preferences: true },
    })
  })

  it('updates both name and timezone', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)

    const updatedHousehold = {
      ...mockHousehold,
      name: 'The Smith Family',
      timezone: 'America/Los_Angeles',
    }
    mockHouseholdUpdate.mockResolvedValue(updatedHousehold as never)

    const request = new Request('http://localhost/api/households/me', {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'The Smith Family',
        timezone: 'America/Los_Angeles',
      }),
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.name).toBe('The Smith Family')
    expect(data.timezone).toBe('America/Los_Angeles')
    expect(data.preferences).toBeDefined()
    expect(mockHouseholdUpdate).toHaveBeenCalledWith({
      where: { id: 'household-123' },
      data: { name: 'The Smith Family', timezone: 'America/Los_Angeles' },
      include: { preferences: true },
    })
  })

  it('handles empty body gracefully', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)
    mockHouseholdUpdate.mockResolvedValue(mockHousehold as never)

    const request = new Request('http://localhost/api/households/me', {
      method: 'PATCH',
      body: JSON.stringify({}),
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.name).toBe("John Doe's Household")
    expect(mockHouseholdUpdate).toHaveBeenCalledWith({
      where: { id: 'household-123' },
      data: {},
      include: { preferences: true },
    })
  })

  it('returns 403 when caller is a non-owner member', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-456', name: 'Jane', email: 'jane@example.com' },
      session: { id: 'session-456' },
    } as never)
    mockFindFirst.mockResolvedValue({ ...mockMembership, role: 'member' } as never)

    const request = new Request('http://localhost/api/households/me', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New Name' }),
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('forbidden')
    expect(mockHouseholdUpdate).not.toHaveBeenCalled()
  })

  it('updates locale to a known value', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)

    const updatedHousehold = { ...mockHousehold, locale: 'et' }
    mockHouseholdUpdate.mockResolvedValue(updatedHousehold as never)

    const request = new Request('http://localhost/api/households/me', {
      method: 'PATCH',
      body: JSON.stringify({ locale: 'et' }),
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.locale).toBe('et')
    expect(mockHouseholdUpdate).toHaveBeenCalledWith({
      where: { id: 'household-123' },
      data: { locale: 'et' },
      include: { preferences: true },
    })
  })

  it('rejects an unknown locale', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const request = new Request('http://localhost/api/households/me', {
      method: 'PATCH',
      body: JSON.stringify({ locale: 'fr' }),
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details.locale).toBeDefined()
  })

  it('ignores unknown fields in request body', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockFindFirst.mockResolvedValue(mockMembership as never)

    const updatedHousehold = { ...mockHousehold, name: 'Valid Name' }
    mockHouseholdUpdate.mockResolvedValue(updatedHousehold as never)

    const request = new Request('http://localhost/api/households/me', {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Valid Name',
        unknownField: 'should be ignored',
        anotherUnknown: 123,
      }),
    })

    const response = await PATCH(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.name).toBe('Valid Name')
    expect(mockHouseholdUpdate).toHaveBeenCalledWith({
      where: { id: 'household-123' },
      data: { name: 'Valid Name' },
      include: { preferences: true },
    })
  })
})
