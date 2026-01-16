import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, PATCH, DELETE } from './route'

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
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    memberPreferences: {
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockFindFirst = vi.mocked(prisma.householdMember.findFirst)
const mockFindUnique = vi.mocked(prisma.householdMember.findUnique)
const mockDelete = vi.mocked(prisma.householdMember.delete)
const mockTransaction = vi.mocked(prisma.$transaction)

describe('GET /api/households/me/members/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'member-123' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when member not found', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: { id: 'household-123', name: 'Test', preferences: null },
    } as never)

    mockFindUnique.mockResolvedValue(null)

    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'nonexistent' }),
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Member not found')
  })

  it('returns member details', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: { id: 'household-123', name: 'Test', preferences: null },
    } as never)

    mockFindUnique.mockResolvedValue({
      id: 'member-manual',
      householdId: 'household-123',
      userId: null,
      name: 'Test Child',
      role: 'member',
      joinedAt: new Date('2024-01-01'),
      user: null,
      preferences: {
        displayName: null,
        portionMultiplier: 0.5,
        dietaryType: null,
        allergens: ['nuts'],
        restrictions: [],
      },
    } as never)

    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'member-manual' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.id).toBe('member-manual')
    expect(data.name).toBe('Test Child')
    expect(data.preferences.allergens).toEqual(['nuts'])
  })
})

describe('PATCH /api/households/me/members/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const request = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated' }),
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'member-123' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 403 when non-owner tries to update another member', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-456', name: 'Jane Doe', email: 'jane@example.com' },
      session: { id: 'session-456' },
    } as never)

    mockFindFirst.mockResolvedValue({
      id: 'member-456',
      householdId: 'household-123',
      userId: 'user-456',
      role: 'member', // Not owner
      household: { id: 'household-123', name: 'Test', preferences: null },
    } as never)

    // Target member is different from requester
    mockFindUnique.mockResolvedValue({
      id: 'member-other',
      householdId: 'household-123',
      userId: 'user-789',
      name: null,
      role: 'member',
    } as never)

    const request = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ preferences: { portionMultiplier: 1.5 } }),
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'member-other' }),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('You can only edit your own preferences')
  })

  it('allows member to update their own preferences', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-456', name: 'Jane Doe', email: 'jane@example.com' },
      session: { id: 'session-456' },
    } as never)

    mockFindFirst.mockResolvedValue({
      id: 'member-456',
      householdId: 'household-123',
      userId: 'user-456',
      role: 'member', // Not owner
      household: { id: 'household-123', name: 'Test', preferences: null },
    } as never)

    // Target member is the same as requester
    mockFindUnique.mockResolvedValue({
      id: 'member-456',
      householdId: 'household-123',
      userId: 'user-456',
      name: null,
      role: 'member',
    } as never)

    const updatedMember = {
      id: 'member-456',
      householdId: 'household-123',
      userId: 'user-456',
      name: null,
      role: 'member',
      joinedAt: new Date(),
      user: { id: 'user-456', name: 'Jane Doe', email: 'jane@example.com', image: null },
      preferences: {
        displayName: null,
        portionMultiplier: 1.25,
        dietaryType: null,
        allergens: [],
        restrictions: [],
        excludedIngredients: [],
        excludedIngredientIds: [],
      },
    }

    mockTransaction.mockImplementation(async (fn) => {
      const tx = {
        householdMember: {
          update: vi.fn().mockResolvedValue({}),
          findUnique: vi.fn().mockResolvedValue(updatedMember),
        },
        memberPreferences: {
          upsert: vi.fn().mockResolvedValue({}),
        },
      }
      return fn(tx as never)
    })

    const request = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({
        preferences: { portionMultiplier: 1.25 },
      }),
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'member-456' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.preferences.portionMultiplier).toBe(1.25)
  })

  it('returns 400 when trying to update name of linked member', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: { id: 'household-123', name: 'Test', preferences: null },
    } as never)

    // Member with userId (linked member)
    mockFindUnique.mockResolvedValue({
      id: 'member-linked',
      householdId: 'household-123',
      userId: 'user-456', // Has userId
      name: null,
      role: 'member',
    } as never)

    const request = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New Name' }),
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'member-linked' }),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Cannot update name for linked members')
  })

  it('updates manual member name and preferences', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: { id: 'household-123', name: 'Test', preferences: null },
    } as never)

    // Manual member (no userId)
    mockFindUnique.mockResolvedValue({
      id: 'member-manual',
      householdId: 'household-123',
      userId: null,
      name: 'Old Name',
      role: 'member',
    } as never)

    const updatedMember = {
      id: 'member-manual',
      householdId: 'household-123',
      userId: null,
      name: 'Updated Child Name',
      role: 'member',
      joinedAt: new Date(),
      user: null,
      preferences: {
        displayName: null,
        portionMultiplier: 0.75,
        dietaryType: null,
        allergens: ['dairy'],
        restrictions: [],
      },
    }

    mockTransaction.mockImplementation(async (fn) => {
      const tx = {
        householdMember: {
          update: vi.fn().mockResolvedValue({}),
          findUnique: vi.fn().mockResolvedValue(updatedMember),
        },
        memberPreferences: {
          upsert: vi.fn().mockResolvedValue({}),
        },
      }
      return fn(tx as never)
    })

    const request = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Updated Child Name',
        preferences: {
          portionMultiplier: 0.75,
          allergens: ['dairy'],
        },
      }),
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'member-manual' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.name).toBe('Updated Child Name')
    expect(data.preferences.portionMultiplier).toBe(0.75)
    expect(data.preferences.allergens).toEqual(['dairy'])
  })

  it('returns 400 when manual member tries to clear display name', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: { id: 'household-123', name: 'Test', preferences: null },
    } as never)

    // Manual member (no userId)
    mockFindUnique.mockResolvedValue({
      id: 'member-manual',
      householdId: 'household-123',
      userId: null,
      name: 'Child Name',
      role: 'member',
    } as never)

    const request = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({
        preferences: { displayName: '' }, // Empty string converts to null
      }),
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'member-manual' }),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Display name is required for manual members')
  })
})

describe('DELETE /api/households/me/members/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'member-123' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 403 when non-owner tries to delete', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-456', name: 'Jane Doe', email: 'jane@example.com' },
      session: { id: 'session-456' },
    } as never)

    mockFindFirst.mockResolvedValue({
      id: 'member-456',
      householdId: 'household-123',
      userId: 'user-456',
      role: 'member',
      household: { id: 'household-123', name: 'Test', preferences: null },
    } as never)

    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'member-manual' }),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Only the household owner can remove members')
  })

  it('returns 400 when owner tries to delete themselves', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: { id: 'household-123', name: 'Test', preferences: null },
    } as never)

    // Owner's own member record
    mockFindUnique.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      name: null,
      role: 'owner',
    } as never)

    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'member-123' }),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Cannot remove yourself from the household')
  })

  it('deletes manual member successfully', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
      session: { id: 'session-123' },
    } as never)

    mockFindFirst.mockResolvedValue({
      id: 'member-123',
      householdId: 'household-123',
      userId: 'user-123',
      role: 'owner',
      household: { id: 'household-123', name: 'Test', preferences: null },
    } as never)

    mockFindUnique.mockResolvedValue({
      id: 'member-manual',
      householdId: 'household-123',
      userId: null,
      name: 'Test Child',
      role: 'member',
    } as never)

    mockDelete.mockResolvedValue({} as never)

    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'member-manual' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockDelete).toHaveBeenCalledWith({
      where: { id: 'member-manual' },
    })
  })
})
