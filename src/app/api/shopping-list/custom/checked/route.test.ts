import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DELETE } from './route'

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
      deleteMany: vi.fn(),
    },
  },
}))

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockGetMembership = vi.mocked(getHouseholdMembership)
const mockDeleteMany = vi.mocked(prisma.customShoppingItem.deleteMany)

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

describe('DELETE /api/shopping-list/custom/checked', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await DELETE()
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 404 when user has no household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(null)

    const response = await DELETE()
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('No household found')
  })

  it('deletes checked items scoped to the caller household', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockDeleteMany.mockResolvedValue({ count: 4 } as never)

    const response = await DELETE()
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.deletedCount).toBe(4)
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { householdId: 'household-123', checked: true },
    })
  })

  it('returns 500 when Prisma throws', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockGetMembership.mockResolvedValue(mockMembership as never)
    mockDeleteMany.mockRejectedValue(new Error('DB down'))

    const response = await DELETE()
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to delete checked items')
  })
})
