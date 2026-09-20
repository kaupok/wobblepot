import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, POST } from './route'

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
      findMany: vi.fn(),
      create: vi.fn(),
    },
    memberPreferences: {
      create: vi.fn(),
    },
    mealPlanEntry: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
    user: {
      findUnique: vi.fn(),
    },
  },
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStartOfTodayInTimezone } from '@/lib/meal-planning/dates'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockFindMany = vi.mocked(prisma.householdMember.findMany)
const mockTransaction = vi.mocked(prisma.$transaction)
const mockEntryUpdateMany = vi.mocked(prisma.mealPlanEntry.updateMany)

/**
 * Run the member-add transaction against spies the assertions below can read.
 * `mealPlanEntry.updateMany` is the same spy as `mockEntryUpdateMany`, so a
 * test can assert that adding a member cleared the household's cached prep tips
 * inside the same transaction as the membership write (HON-684).
 */
const mockMemberTransaction = (createdMember: unknown) => {
  const tx = {
    householdMember: {
      create: vi.fn().mockResolvedValue({ id: 'member-new' }),
      findUnique: vi.fn().mockResolvedValue(createdMember),
    },
    memberPreferences: {
      create: vi.fn().mockResolvedValue({}),
    },
    mealPlanEntry: {
      updateMany: mockEntryUpdateMany,
    },
  }
  mockTransaction.mockImplementation(async (fn) => (fn as (tx: unknown) => never)(tx))
  return tx
}

describe('GET /api/households/me/members', () => {
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

  it('returns 404 when no household found', async () => {
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

  it('returns members with user info and preferences', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: {
        id: 'household-123',
        name: "John Doe's Household",
        preferences: null,
      },
    } as never)

    const mockMembers = [
      {
        id: 'member-123',
        householdId: 'household-123',
        userId: 'user-123',
        role: 'owner',
        joinedAt: new Date('2024-01-01'),
        user: {
          id: 'user-123',
          name: 'John Doe',
          email: 'john@example.com',
          image: null,
        },
        preferences: {
          id: 'prefs-123',
          memberId: 'member-123',
          displayName: 'Dad',
          portionMultiplier: 1.0,
          dietaryType: null,
          allergens: [],
          restrictions: [],
        },
      },
      {
        id: 'member-456',
        householdId: 'household-123',
        userId: 'user-456',
        name: null,
        role: 'member',
        joinedAt: new Date('2024-01-15'),
        user: {
          id: 'user-456',
          name: 'Jane Doe',
          email: 'jane@example.com',
          image: 'https://example.com/jane.jpg',
        },
        preferences: null,
      },
    ]

    mockFindMany.mockResolvedValue(mockMembers as never)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.householdId).toBe('household-123')
    expect(data.members).toHaveLength(2)

    // First member with preferences
    expect(data.members[0].id).toBe('member-123')
    expect(data.members[0].userId).toBe('user-123')
    expect(data.members[0].role).toBe('owner')
    expect(data.members[0].user.name).toBe('John Doe')
    expect(data.members[0].user.email).toBe('john@example.com')
    expect(data.members[0].preferences).toEqual({
      displayName: 'Dad',
      portionMultiplier: 1.0,
      dietaryType: null,
      allergens: [],
      restrictions: [],
    })

    // Second member without preferences
    expect(data.members[1].id).toBe('member-456')
    expect(data.members[1].role).toBe('member')
    expect(data.members[1].user.name).toBe('Jane Doe')
    expect(data.members[1].preferences).toBeNull()
  })

  it('queries members with correct household ID', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-999',
      userId: 'user-123',
      role: 'owner',
      household: {
        id: 'household-999',
        name: 'Test Household',
        preferences: null,
      },
    } as never)

    mockFindMany.mockResolvedValue([])

    await GET()

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { householdId: 'household-999' },
      }),
    )
  })

  it('returns manual members with name field', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: {
        id: 'household-123',
        name: "John's Household",
        preferences: null,
      },
    } as never)

    const mockMembers = [
      {
        id: 'member-123',
        householdId: 'household-123',
        userId: 'user-123',
        name: null,
        role: 'owner',
        joinedAt: new Date('2024-01-01'),
        user: {
          id: 'user-123',
          name: 'John Doe',
          email: 'john@example.com',
          image: null,
        },
        preferences: null,
      },
      {
        id: 'member-manual',
        householdId: 'household-123',
        userId: null,
        name: 'Little Johnny',
        role: 'member',
        joinedAt: new Date('2024-01-15'),
        user: null,
        preferences: {
          id: 'prefs-manual',
          memberId: 'member-manual',
          displayName: null,
          portionMultiplier: 0.5,
          dietaryType: null,
          allergens: ['nuts', 'peanuts'],
          restrictions: [],
        },
      },
    ]

    mockFindMany.mockResolvedValue(mockMembers as never)

    const response = await GET()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.members).toHaveLength(2)

    // Manual member
    expect(data.members[1].id).toBe('member-manual')
    expect(data.members[1].userId).toBeNull()
    expect(data.members[1].name).toBe('Little Johnny')
    expect(data.members[1].user).toBeNull()
    expect(data.members[1].preferences.allergens).toEqual(['nuts', 'peanuts'])
    expect(data.members[1].preferences.portionMultiplier).toBe(0.5)
  })
})

describe('POST /api/households/me/members', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const request = new Request('http://localhost/api/households/me/members', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Child' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 403 when non-owner tries to add member', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-456', name: 'Jane Doe', email: 'jane@example.com' },
      session: { id: 'session-456' },
    } as never)

    mockFindFirst.mockResolvedValue({
      id: 'member-456',
      householdId: 'household-123',
      userId: 'user-456',
      role: 'member', // Not owner
      household: {
        id: 'household-123',
        name: 'Test Household',
        preferences: null,
      },
    } as never)

    const request = new Request('http://localhost/api/households/me/members', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Child' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Only the household owner can add members')
  })

  it('returns 400 for invalid request body', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: {
        id: 'household-123',
        name: 'Test Household',
        preferences: null,
      },
    } as never)

    const request = new Request('http://localhost/api/households/me/members', {
      method: 'POST',
      body: JSON.stringify({ name: '' }), // Empty name
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Validation failed')
  })

  it('creates manual member with name and preferences', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: {
        id: 'household-123',
        name: 'Test Household',
        preferences: null,
      },
    } as never)

    const createdMember = {
      id: 'member-new',
      householdId: 'household-123',
      userId: null,
      name: 'Test Child',
      role: 'member',
      joinedAt: new Date(),
      preferences: {
        id: 'prefs-new',
        memberId: 'member-new',
        displayName: null,
        portionMultiplier: 0.5,
        dietaryType: null,
        allergens: ['nuts'],
        restrictions: [],
      },
    }

    mockMemberTransaction(createdMember)

    const request = new Request('http://localhost/api/households/me/members', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test Child',
        preferences: {
          portionMultiplier: 0.5,
          allergens: ['nuts'],
        },
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.id).toBe('member-new')
    expect(data.name).toBe('Test Child')
    expect(data.userId).toBeNull()
    expect(data.user).toBeNull()
    expect(data.role).toBe('member')
    expect(data.preferences.allergens).toEqual(['nuts'])
    expect(data.preferences.portionMultiplier).toBe(0.5)
  })

  // The new member raises the household's size, which prices the cached
  // prep-tips prompt on every entry without a `servingOverride` (HON-684).
  it('clears cached preparation tips on the household future entries', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue({
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
    } as never)

    mockMemberTransaction({
      id: 'member-new',
      householdId: 'household-123',
      userId: null,
      name: 'Test Child',
      role: 'member',
      joinedAt: new Date(),
      preferences: null,
    })

    const request = new Request('http://localhost/api/households/me/members', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Child' }),
    })

    const response = await POST(request)

    expect(response.status).toBe(201)
    // Inside the same transaction as the membership write, so a failed write
    // leaves neither the new member nor an emptied cache behind.
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockEntryUpdateMany).toHaveBeenCalledTimes(1)
    expect(mockEntryUpdateMany).toHaveBeenCalledWith({
      where: {
        plan: { householdId: 'household-123' },
        // An entry with an override was priced from the override, not from the
        // member count, and an entry already in the past is never read again.
        servingOverride: null,
        preparationTips: { not: null },
        date: { gte: getStartOfTodayInTimezone('Europe/Tallinn') },
      },
      data: { preparationTips: null },
    })
  })

  it.each([
    ['a non-owner is rejected', { role: 'member', userId: 'user-456' }, { name: 'Test Child' }],
    ['the body fails validation', { role: 'owner', userId: 'user-123' }, { name: '' }],
  ])('leaves preparation tips alone when %s', async (_case, membership, body) => {
    mockGetSession.mockResolvedValue({
      user: { id: membership.userId, name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: membership.userId,
      role: membership.role,
      household: {
        id: 'household-123',
        name: 'Test Household',
        timezone: 'Europe/Tallinn',
        preferences: null,
      },
    } as never)

    const request = new Request('http://localhost/api/households/me/members', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    const response = await POST(request)

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockEntryUpdateMany).not.toHaveBeenCalled()
  })
})
