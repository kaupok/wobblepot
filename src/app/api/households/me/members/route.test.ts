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
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockFindMany = vi.mocked(prisma.householdMember.findMany)

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
          restrictions: [],
        },
      },
      {
        id: 'member-456',
        householdId: 'household-123',
        userId: 'user-456',
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
      })
    )
  })
})
