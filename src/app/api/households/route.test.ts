import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
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
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/errors', () => ({
  captureApiError: vi.fn(),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { captureApiError } from '@/lib/errors'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockTransaction = vi.mocked(prisma.$transaction)
const mockCaptureApiError = vi.mocked(captureApiError)

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

    // Mock transaction where findFirst returns existing membership
    mockTransaction.mockImplementation(async (callback) => {
      const mockTx = {
        householdMember: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'member-123',
            householdId: 'household-123',
            userId: 'user-123',
            role: 'owner',
          }),
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

    expect(response.status).toBe(400)
    expect(data.error).toBe('already_in_household')
    expect(data.message).toBe('You are already a member of a household.')
  })

  it('creates the membership at Serializable isolation', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockTransaction.mockImplementation(async (callback) => {
      const mockTx = {
        householdMember: { findFirst: vi.fn().mockResolvedValue(null) },
        household: {
          create: vi.fn().mockResolvedValue({ id: 'household-1' }),
          findUnique: vi.fn().mockResolvedValue({ id: 'household-1', name: 'My Household' }),
        },
        householdPreferences: { create: vi.fn() },
      }
      mockTx.householdMember = {
        ...mockTx.householdMember,
        create: vi.fn(),
      } as never
      return callback(mockTx as never)
    })

    const request = new Request('http://localhost/api/households', {
      method: 'POST',
      body: JSON.stringify({ name: 'My Household' }),
    })

    await POST(request)

    // Without Serializable this check is a SELECT matching zero rows, so it
    // takes no lock: two concurrent creates for the same user insert two
    // *different* member rows and `@@unique([householdId, userId])` never
    // fires. A double submit is enough. It also has to hold on *this* side —
    // PostgreSQL only registers the conflict when the writing transaction is
    // serializable too, so a read-committed create here would reopen the race
    // for the invite-join route as well (HON-679).
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })
  })

  it('answers a persistent serialization failure with a reported JSON 500', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)
    mockTransaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('could not serialize access', {
        code: 'P2034',
        clientVersion: 'test',
      }),
    )

    const request = new Request('http://localhost/api/households', {
      method: 'POST',
      body: JSON.stringify({ name: 'My Household' }),
    })

    const response = await POST(request)
    const data = await response.json()

    // Rethrowing would let Next render an HTML error page, and
    // CreateHouseholdForm calls `response.json()` outside its network-error
    // try — so the user would see a raw SyntaxError and nothing would be
    // reported. Serializable retries make this reachable.
    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to create household')
    expect(mockCaptureApiError).toHaveBeenCalledTimes(1)
  })

  it('returns 400 for invalid JSON', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

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

    const mockHousehold = {
      id: 'household-123',
      name: 'My Household',
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

    mockTransaction.mockImplementation(async (callback) => {
      const mockTx = {
        household: {
          create: vi.fn().mockResolvedValue({ id: 'household-123' }),
          findUnique: vi.fn().mockResolvedValue(mockHousehold),
        },
        householdMember: {
          findFirst: vi.fn().mockResolvedValue(null),
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

  it('persists Estonian when Accept-Language prefers et (HON-549 — public flip)', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const { headers } = await import('next/headers')
    vi.mocked(headers).mockResolvedValueOnce(
      new Headers({ 'accept-language': 'et,en;q=0.9' }) as never,
    )

    const createSpy = vi.fn().mockResolvedValue({ id: 'household-123' })
    const mockHousehold = {
      id: 'household-123',
      name: 'My Household',
      timezone: 'Europe/Tallinn',
      locale: 'et',
      createdAt: new Date('2026-06-02'),
      preferences: null,
    }

    mockTransaction.mockImplementation(async (callback) => {
      const mockTx = {
        household: {
          create: createSpy,
          findUnique: vi.fn().mockResolvedValue(mockHousehold),
        },
        householdMember: {
          findFirst: vi.fn().mockResolvedValue(null),
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
    expect(createSpy).toHaveBeenCalledWith({ data: { name: 'My Household', locale: 'et' } })
    expect(data.locale).toBe('et')
  })

  it('persists Estonian for the regional et-EE Accept-Language tag', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const { headers } = await import('next/headers')
    vi.mocked(headers).mockResolvedValueOnce(new Headers({ 'accept-language': 'et-EE' }) as never)

    const createSpy = vi.fn().mockResolvedValue({ id: 'household-123' })
    const mockHousehold = {
      id: 'household-123',
      name: 'My Household',
      timezone: 'Europe/Tallinn',
      locale: 'et',
      createdAt: new Date('2026-06-02'),
      preferences: null,
    }

    mockTransaction.mockImplementation(async (callback) => {
      const mockTx = {
        household: {
          create: createSpy,
          findUnique: vi.fn().mockResolvedValue(mockHousehold),
        },
        householdMember: {
          findFirst: vi.fn().mockResolvedValue(null),
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
    expect(createSpy).toHaveBeenCalledWith({ data: { name: 'My Household', locale: 'et' } })
    expect(data.locale).toBe('et')
  })

  it('persists default locale when no Accept-Language header is present', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const createSpy = vi.fn().mockResolvedValue({ id: 'household-123' })
    const mockHousehold = {
      id: 'household-123',
      name: 'My Household',
      timezone: 'Europe/Tallinn',
      locale: 'en',
      createdAt: new Date('2026-04-22'),
      preferences: null,
    }

    mockTransaction.mockImplementation(async (callback) => {
      const mockTx = {
        household: {
          create: createSpy,
          findUnique: vi.fn().mockResolvedValue(mockHousehold),
        },
        householdMember: {
          findFirst: vi.fn().mockResolvedValue(null),
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
    expect(createSpy).toHaveBeenCalledWith({ data: { name: 'My Household', locale: 'en' } })
    expect(data.locale).toBe('en')
  })

  it('ignores unknown fields in request body', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    const mockHousehold = {
      id: 'household-123',
      name: 'Valid Household',
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

    mockTransaction.mockImplementation(async (callback) => {
      const mockTx = {
        household: {
          create: vi.fn().mockResolvedValue({ id: 'household-123' }),
          findUnique: vi.fn().mockResolvedValue(mockHousehold),
        },
        householdMember: {
          findFirst: vi.fn().mockResolvedValue(null),
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
