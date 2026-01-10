import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'

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
  createHouseholdForUser: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    householdMember: {
      findFirst: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}))

import { auth, createHouseholdForUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockFindUser = vi.mocked(prisma.user.findUnique)
const mockCreateHousehold = vi.mocked(createHouseholdForUser)

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
        dietaryType: 'omnivore',
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
    expect(data.preferences.dietaryType).toBe('omnivore')
  })

  it('self-heals by creating household if user has none', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-456', name: 'Jane Doe', email: 'jane@example.com' },
      session: { id: 'session-456' },
    } as never)

    const mockHousehold = {
      id: 'household-456',
      name: "Jane Doe's Household",
      timezone: 'Europe/Tallinn',
      createdAt: new Date('2024-01-01'),
      preferences: {
        id: 'prefs-456',
        householdId: 'household-456',
      },
    }

    // First call returns null, second call returns the newly created household
    mockFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'member-456',
        householdId: 'household-456',
        userId: 'user-456',
        role: 'owner',
        household: mockHousehold,
      } as never)

    mockFindUser.mockResolvedValue({ name: 'Jane Doe' } as never)
    mockCreateHousehold.mockResolvedValue(undefined)

    const response = await GET()
    const data = await response.json()

    expect(mockCreateHousehold).toHaveBeenCalledWith('user-456', 'Jane Doe')
    expect(response.status).toBe(200)
    expect(data.id).toBe('household-456')
  })

  it('returns 404 if household creation fails', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-789', name: 'Bob', email: 'bob@example.com' },
      session: { id: 'session-789' },
    } as never)

    // Both calls return null (household creation somehow failed)
    mockFindFirst.mockResolvedValue(null)
    mockFindUser.mockResolvedValue({ name: 'Bob' } as never)
    mockCreateHousehold.mockResolvedValue(undefined)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })
})
