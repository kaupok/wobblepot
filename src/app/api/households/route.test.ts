import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

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
    $transaction: vi.fn(),
  },
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockTransaction = vi.mocked(prisma.$transaction)

describe('POST /api/households', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households', {
      method: 'POST',
      body: JSON.stringify({ name: 'My Household' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 400 when user already has a household', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
    } as never)

    const request = new Request('http://localhost/api/households', {
      method: 'POST',
      body: JSON.stringify({ name: 'My Household' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('already_in_household')
    expect(data.message).toBe('You are already a member of a household.')
  })

  it('returns 400 for invalid JSON', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households', {
      method: 'POST',
      body: 'not valid json',
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 400 for missing name', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households', {
      method: 'POST',
      body: JSON.stringify({}),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details.name).toBeDefined()
  })

  it('returns 400 for empty name', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households', {
      method: 'POST',
      body: JSON.stringify({ name: '' }),
    })

    const response = await POST(request)
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

    mockFindFirst.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households', {
      method: 'POST',
      body: JSON.stringify({ name: 'a'.repeat(101) }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
    expect(data.details.name).toBeDefined()
  })

  it('creates household with owner role and returns 201', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(null)

    const mockHousehold = {
      id: 'household-123',
      name: 'My Household',
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

    mockTransaction.mockImplementation(async (callback) => {
      const mockTx = {
        household: {
          create: vi.fn().mockResolvedValue({ id: 'household-123' }),
          findUnique: vi.fn().mockResolvedValue(mockHousehold),
        },
        householdMember: {
          create: vi.fn().mockResolvedValue({ id: 'member-123' }),
        },
        householdPreferences: {
          create: vi.fn().mockResolvedValue({ id: 'prefs-123' }),
        },
      }
      return callback(mockTx as never)
    })

    const request = new Request('http://localhost/api/households', {
      method: 'POST',
      body: JSON.stringify({ name: 'My Household' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.id).toBe('household-123')
    expect(data.name).toBe('My Household')
    expect(data.timezone).toBe('Europe/Tallinn')
    expect(data.preferences).toBeDefined()
  })

  it('ignores unknown fields in request body', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue(null)

    const mockHousehold = {
      id: 'household-123',
      name: 'Valid Household',
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

    mockTransaction.mockImplementation(async (callback) => {
      const mockTx = {
        household: {
          create: vi.fn().mockResolvedValue({ id: 'household-123' }),
          findUnique: vi.fn().mockResolvedValue(mockHousehold),
        },
        householdMember: {
          create: vi.fn().mockResolvedValue({ id: 'member-123' }),
        },
        householdPreferences: {
          create: vi.fn().mockResolvedValue({ id: 'prefs-123' }),
        },
      }
      return callback(mockTx as never)
    })

    const request = new Request('http://localhost/api/households', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Valid Household',
        unknownField: 'should be ignored',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.name).toBe('Valid Household')
  })
})
